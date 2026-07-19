-- Phase 3 Plan 05: notification persistence + delivery claim mechanics.
--
-- This migration is the STRUCTURAL backbone of the notification dispatcher
-- (notify-tick). Three ideas carry the safety guarantees:
--
--   1. push_subscriptions holds each browser's PushSubscription JSON. Endpoint
--      secrets are per-user credentials, so own-row RLS blocks cross-user reads
--      (T-3-19); the service role reads them only to SEND. Push payloads never
--      carry those secrets regardless (T-3-21).
--
--   2. notifications is the exactly-once ledger. unique (user_id, job_id, channel)
--      makes a double-notify STRUCTURALLY impossible (NOTF-04) — it survives
--      crashes and retries where in-memory "already sent" tracking would not.
--
--   3. claim_notifications (SKIP LOCKED) lets a notify-tick atomically OWN a batch
--      of queued rows before any external send, so two concurrent ticks can never
--      double-SEND the same rows (Codex F3 — the unique constraint stops duplicate
--      ROWS, not duplicate SENDS).
--
-- Retry safety (Codex F4): status = 'failed' is TERMINAL and reserved for
-- permanent errors only (dead endpoint 410/404, or attempts exhausted). A
-- transient push/Resend failure keeps status = 'queued' with a future retry_at so
-- it is retried on a later tick — a flaky push service must never permanently
-- suppress a notification. last_digest_date advances only on a confirmed 2xx.
--
-- Migration numbering is PINNED to 0020 (Codex F1 — no OFFSET math); it sorts
-- after 0019_user_jobs_scoring.sql. No jobs.source value is referenced anywhere.

-- 1. push_subscriptions — per-user CRUD (locked 0002_resumes.sql pattern).
-- The endpoint is the natural upsert key (one row per browser push endpoint);
-- the subscription jsonb carries the full PushSubscription (keys.p256dh/keys.auth)
-- the edge sender needs. Own-row RLS on every operation isolates users; the
-- service role bypasses RLS to read subscriptions when sending.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz
);

alter table public.push_subscriptions enable row level security;

create index push_subscriptions_user_id_idx on public.push_subscriptions using btree (user_id);

grant select, insert, update, delete on table public.push_subscriptions to authenticated;

create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "push_subscriptions_insert_own" on public.push_subscriptions
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "push_subscriptions_update_own" on public.push_subscriptions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "push_subscriptions_delete_own" on public.push_subscriptions
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- 2. notifications — the exactly-once delivery ledger (service-written,
-- user-readable; 0006 jobs-pipeline grant style). The unique constraint below IS
-- the double-notify prevention (NOTF-04); it holds across crashes and retries.
-- status lifecycle: 'queued' -> 'claimed' (owned by a tick via claim_notifications)
-- -> 'sent' (confirmed delivery) OR back to 'queued' (transient retry) OR 'failed'
-- (TERMINAL: permanent error only — dead endpoint 410/404 or attempts>=5, Codex
-- F4). retry_at gates when a queued row becomes claimable again; attempts caps the
-- retry budget; error_code stores a bounded machine code (never PII/endpoints).
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  channel text not null check (channel in ('push', 'email', 'digest')),
  status text not null default 'queued'
    check (status in ('queued', 'claimed', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts integer not null default 0,
  retry_at timestamptz,
  sent_at timestamptz,
  error_code text,
  unique (user_id, job_id, channel)
);

alter table public.notifications enable row level security;

create index notifications_claim_idx on public.notifications
  using btree (channel, status, retry_at);
create index notifications_user_id_idx on public.notifications using btree (user_id);

-- Service-role writes only; users may read their own rows (future log view).
revoke all on table public.notifications from anon, authenticated;
grant select on table public.notifications to authenticated;

create policy "notifications_select_own" on public.notifications
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- 2b. claim_notifications (Codex F3): atomically claim a batch of queued rows for
-- ONE channel before any external send. Mirrors claim_due_companies (0008):
-- security invoker, empty search_path, service_role-only execute. The SKIP LOCKED
-- scan means two concurrent notify-ticks take DISJOINT batches and can never
-- send the same row. A row is claimable when it is queued, its retry_at (if any)
-- has elapsed, and any prior claim is stale (>5 min — a tick that crashed
-- mid-send releases its rows for reclaim). Claiming bumps attempts so the retry
-- budget (F4) is enforced by the same step that owns the row.
create or replace function public.claim_notifications(
  p_channel text,
  batch_size integer default 50
)
returns setof public.notifications
language sql
security invoker
set search_path = ''
as $$
  with claimable as (
    select id
    from public.notifications
    where channel = p_channel
      and status = 'queued'
      and (retry_at is null or retry_at <= now())
      and (claimed_at is null or claimed_at < now() - interval '5 minutes')
    order by created_at asc
    limit batch_size
    for update skip locked
  )
  update public.notifications n
  set status = 'claimed',
      claimed_at = now(),
      attempts = n.attempts + 1
  from claimable
  where n.id = claimable.id
  returning n.*;
$$;

revoke execute on function public.claim_notifications(text, integer) from public, anon, authenticated;
grant execute on function public.claim_notifications(text, integer) to service_role;

-- 3. Digest-sent-today bookkeeping (D-20). The service role advances this to the
-- user's local date ONLY after a confirmed 2xx digest send (Codex F4), so a failed
-- send never suppresses tomorrow's retry. Existing user preference policies are
-- unaffected (service role bypasses RLS to write it).
alter table public.preferences add column last_digest_date date;

-- 4. notify-tick scheduler. Same verify_jwt-off + x-cron-secret boundary as
-- poll-tick/score-tick (0006); the secret lives only in Vault and the Edge
-- Function environment, so early ticks before Vault is configured fail closed.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'notify-tick-every-minute',
  '* * * * *',
  $cron$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'project_url'
    ) || '/functions/v1/notify-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'cron_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);

-- 5. delete_my_data() replacement (AUTH-04). Reproduces the 0004 body and appends
-- the user-owned tables introduced since: preferences, user_jobs,
-- push_subscriptions, notifications. resume_extracts is NOT listed here — it dies
-- via the FK cascade from resumes (on delete cascade), preserving AUTH-04
-- deletion semantics. security invoker + empty search_path + the revoke/grant tail
-- are identical to 0004.
create or replace function public.delete_my_data()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.resumes
  where user_id = (select auth.uid());

  -- resume_extracts dies via FK cascade from resumes (0018 on delete cascade).

  delete from public.preferences
  where user_id = (select auth.uid());

  delete from public.user_jobs
  where user_id = (select auth.uid());

  delete from public.push_subscriptions
  where user_id = (select auth.uid());

  delete from public.notifications
  where user_id = (select auth.uid());
end;
$$;

revoke execute on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;

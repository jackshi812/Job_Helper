-- Phase 3 Plan 03: per-user scoring state + decoupled scan/claim mechanics.
--
-- user_jobs is the per-user projection over the shared, deduplicated jobs pool
-- (RESEARCH Pattern 4 — service-written, column-limited user writes). The
-- score-tick worker writes every pipeline column; authenticated users may read
-- their own rows and write ONLY seen_at / dismissed_at. The column-level UPDATE
-- grant is the enforcement: users physically cannot alter their own scores
-- (T-3-11 elevation). One row per (user, job) — unique (user_id, job_id).
--
-- Scoring is fully decoupled from ingestion (02.1 isolation): score-tick never
-- hooks poll-tick. It claims work through claim_scoring_work, a SKIP LOCKED RPC
-- mirroring claim_due_companies (0008), so the two pipelines never contend and a
-- slow tick cannot double-process a row. The claim locks ONLY user_jobs rows.
--
-- Retroactive feedback (D-04) + rescore window (D-10) are a single boolean flag,
-- needs_refilter, raised over a bounded 7-day window by two RPCs:
--   * mark_recent_jobs_for_refilter()  — user-invoked (preferences/resume edits)
--   * mark_user_jobs_for_reroute(uuid) — service-role (extract-resume on 'ready',
--     Codex F2: a newly extracted resume must enter D-06 routing).
-- The worker decides whether a flagged row actually needs a paid re-score
-- (Pitfall 6 economy); the flag itself is free to raise.
--
-- Rows die with their job via the job_id FK cascade; poll-tick prunes jobs older
-- than ~30 days (500MB DB budget), so this per-user table stays small at 2 users.
-- No jobs.source value is referenced anywhere — scoring is source-agnostic
-- (RESEARCH Pitfall 8).

create table public.user_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,

  -- Pipeline state.
  status text not null default 'pending'
    check (status in ('pending', 'filtered', 'scored', 'failed')),
  filter_reason text
    check (filter_reason in ('excluded_keyword', 'wrong_location', 'title_non_overlap')),
  filter_detail text,
  attempts integer not null default 0,
  claimed_at timestamptz,
  error_code text,

  -- Scoring results (D-07 tiers, D-09 reasons, D-17 gap panel).
  score integer check (score between 0 and 100),
  tier text check (tier in ('Strong', 'Good', 'Weak')),
  reasons jsonb,
  gaps jsonb,
  covered jsonb,
  matched_include_keywords jsonb,
  routed_resume_id uuid references public.resumes (id) on delete set null,
  runner_up_resume_id uuid references public.resumes (id) on delete set null,
  scored_at timestamptz,

  -- Per-user feed state (D-16).
  seen_at timestamptz,
  dismissed_at timestamptz,

  -- Retroactive refilter / rescore flag (D-04 / D-10).
  needs_refilter boolean not null default false,

  unique (user_id, job_id)
);

alter table public.user_jobs enable row level security;

create index user_jobs_user_status_idx on public.user_jobs using btree (user_id, status);
create index user_jobs_job_id_idx on public.user_jobs using btree (job_id);
create index user_jobs_needs_refilter_idx on public.user_jobs using btree (needs_refilter)
  where needs_refilter;

-- Column-limited user writes: read own rows; update ONLY seen_at / dismissed_at.
-- The pipeline (service_role) bypasses RLS and writes every other column.
revoke all on table public.user_jobs from anon, authenticated;
grant select on public.user_jobs to authenticated;
grant update (seen_at, dismissed_at) on public.user_jobs to authenticated;

create policy "user_jobs_select_own" on public.user_jobs
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "user_jobs_update_own" on public.user_jobs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- claim_scoring_work: the scan/claim mechanism (mirrors claim_due_companies,
-- 0008). Two steps in one SQL body:
--   1. Seed — ensure a row exists for every open, recent job x user. At 2 users
--      with a 30-day open-job window this cross join stays tiny (RESEARCH Open
--      Question 4). on conflict do nothing keeps it idempotent.
--   2. Claim — take pending OR needs_refilter rows whose attempts are under the
--      poison-pill cap and whose prior claim (if any) is stale (>5 min), newest
--      posting first so fresh jobs jump the rescore backlog (Pitfall 2). The
--      locking clause is on the user_jobs scan only (single-table FROM), so this
--      never locks jobs rows and cannot contend with poll-tick.
create or replace function public.claim_scoring_work(batch_size integer default 12)
returns setof public.user_jobs
language sql
security invoker
set search_path = ''
as $$
  insert into public.user_jobs (user_id, job_id)
  select u.id, j.id
  from auth.users u
  cross join public.jobs j
  where j.status = 'open'
    and j.first_seen_at > now() - interval '30 days'
    and not exists (
      select 1 from public.user_jobs uj
      where uj.user_id = u.id and uj.job_id = j.id
    )
  on conflict (user_id, job_id) do nothing;

  with claimable as (
    select uj.id
    from public.user_jobs uj
    where (uj.status = 'pending' or uj.needs_refilter)
      and uj.attempts < 5
      and (uj.claimed_at is null or uj.claimed_at < now() - interval '5 minutes')
    order by (
      select j.first_seen_at from public.jobs j where j.id = uj.job_id
    ) desc
    limit batch_size
    for update skip locked
  )
  update public.user_jobs uj
  set claimed_at = now(),
      attempts = uj.attempts + 1
  from claimable
  where uj.id = claimable.id
  returning uj.*;
$$;

revoke execute on function public.claim_scoring_work(integer) from public, anon, authenticated;
grant execute on function public.claim_scoring_work(integer) to service_role;

-- mark_recent_jobs_for_refilter: user-invoked retroactive feedback (D-04) bounded
-- to the D-10 7-day rescore window. Called by savePreferences and resume
-- upload/delete. Follows the 0004 delete_my_data user-scoped shape (security
-- invoker, auth.uid() scoping). Only raises the free flag; the worker decides
-- whether a paid re-score is actually warranted. Jobs older than 7 days keep
-- their stale scores (D-10).
create or replace function public.mark_recent_jobs_for_refilter()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.user_jobs
  set needs_refilter = true
  where user_id = (select auth.uid())
    and job_id in (
      select id from public.jobs where first_seen_at > now() - interval '7 days'
    );
end;
$$;

revoke execute on function public.mark_recent_jobs_for_refilter() from public, anon;
grant execute on function public.mark_recent_jobs_for_refilter() to authenticated;

-- mark_user_jobs_for_reroute (Codex F2): the SERVICE-ROLE variant of the refilter
-- flag. The extract-resume worker calls this when a resume extraction transitions
-- to 'ready' so the newly extracted resume actually enters D-06 routing. It takes
-- an explicit user_id because the caller is the service role acting on the resume
-- owner's behalf — there is no auth.uid() in the cron context. Same bounded 7-day
-- window. Without it, a resume uploaded before its extraction completed would
-- never become a routing candidate (the browser refilter fired before the
-- extraction existed). Mirrors 0008's revoke/grant tail: service_role only.
create or replace function public.mark_user_jobs_for_reroute(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.user_jobs
  set needs_refilter = true
  where user_id = p_user_id
    and job_id in (
      select id from public.jobs where first_seen_at > now() - interval '7 days'
    );
end;
$$;

revoke execute on function public.mark_user_jobs_for_reroute(uuid) from public, anon, authenticated;
grant execute on function public.mark_user_jobs_for_reroute(uuid) to service_role;

-- score-tick scheduler. Same verify_jwt-off + x-cron-secret boundary as poll-tick
-- (0006); the secret lives only in Vault and the Edge Function environment, so
-- early ticks before Vault is configured fail closed.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'score-tick-every-minute',
  '* * * * *',
  $cron$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'project_url'
    ) || '/functions/v1/score-tick',
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

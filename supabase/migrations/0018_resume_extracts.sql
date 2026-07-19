-- Phase 3 Plan 02: resume extraction cache + AI usage accounting.
--
-- resume_extracts holds exactly one cached extraction per uploaded resume:
-- full text (for D-08 full-text scoring prompts) plus routing keywords (for
-- D-06 resume routing). Rows are service-role written by the extract-resume
-- edge function; authenticated users may only read their own. Extraction data
-- FK-cascades on resume delete, so it dies with the resume (AUTH-04 user-
-- controlled deletion).
--
-- ai_usage records token counts and cost inputs only. Prompt/response content
-- (resume + JD text) is NEVER persisted or logged (ASVS V7; T-3-05). The table
-- is service-role only — no authenticated grants, no user policies.
--
-- Work is claimed atomically via claim_resume_extractions (SKIP LOCKED) so
-- overlapping 1-minute crons cannot double-call/double-bill OpenAI for the same
-- resume (Codex F-extract-claim; T-3-08a).

create table public.resume_extracts (
  resume_id uuid primary key references public.resumes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  text_content text,
  keywords jsonb not null default '[]',
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'ready', 'failed', 'unsupported_format')),
  error_code text,
  attempts integer not null default 0,
  claimed_at timestamptz,
  model text,
  extracted_at timestamptz
);

alter table public.resume_extracts enable row level security;

create index resume_extracts_user_id_idx
  on public.resume_extracts using btree (user_id);

revoke all on table public.resume_extracts from anon, authenticated;
grant select on table public.resume_extracts to authenticated;

create policy "resume_extracts_select_own" on public.resume_extracts
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Service-role only: stores token counts and cost inputs, never prompt content.
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  purpose text not null check (purpose in ('extract', 'score', 'triage')),
  model text not null,
  prompt_tokens integer not null,
  output_tokens integer not null,
  user_id uuid
);

alter table public.ai_usage enable row level security;

revoke all on table public.ai_usage from anon, authenticated;

-- Extraction work is claimed exclusively so overlapping crons never double-bill
-- OpenAI for the same resume (Codex F-extract-claim). First seed a pending row
-- for every resume lacking one, then claim a bounded batch with SKIP LOCKED,
-- marking claimed rows and incrementing attempts before any billing occurs.
-- Stale claims (crashed workers) become reclaimable after 5 minutes.
create or replace function public.claim_resume_extractions(batch_size integer default 3)
returns setof public.resume_extracts
language sql
security invoker
set search_path = ''
as $$
  insert into public.resume_extracts (resume_id, user_id)
  select r.id, r.user_id
  from public.resumes r
  where not exists (
    select 1 from public.resume_extracts e where e.resume_id = r.id
  )
  on conflict (resume_id) do nothing;

  with claimable as (
    select resume_id
    from public.resume_extracts
    where status in ('pending', 'claimed', 'failed')
      and attempts < 3
      and (claimed_at is null or claimed_at < now() - interval '5 minutes')
    order by attempts asc
    limit batch_size
    for update skip locked
  )
  update public.resume_extracts e
  set status = 'claimed',
      claimed_at = now(),
      attempts = e.attempts + 1
  from claimable
  where e.resume_id = claimable.resume_id
  returning e.*;
$$;

revoke execute on function public.claim_resume_extractions(integer) from public, anon, authenticated;
grant execute on function public.claim_resume_extractions(integer) to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Same verify_jwt-off + x-cron-secret boundary as poll-tick (0006). The secret
-- lives only in Vault and the Edge Function environment; early ticks before Vault
-- is configured fail closed.
select cron.schedule(
  'extract-resume-every-minute',
  '* * * * *',
  $cron$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'project_url'
    ) || '/functions/v1/extract-resume',
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

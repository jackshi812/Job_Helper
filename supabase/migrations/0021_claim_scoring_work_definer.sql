-- 0021: fix claim_scoring_work permission on auth.users.
--
-- claim_scoring_work (0019) seeds user_jobs by cross-joining auth.users with open
-- jobs. It was declared `security invoker`, so when the Edge Function calls it with
-- the service_role key the body runs as service_role — which has no SELECT on
-- auth.users. The RPC therefore failed with 42501 "permission denied for table
-- users", surfacing as score-tick HTTP 500 before any work was claimed.
--
-- Flip it to `security definer` so the body runs as the function owner (postgres),
-- which can read auth.users. The function keeps `set search_path = ''` and every
-- reference stays fully schema-qualified, so the definer context cannot be hijacked
-- via search_path. Execute is still revoked from public/anon/authenticated and
-- granted only to service_role (unchanged from 0019), so the only caller remains the
-- cron-authenticated Edge Function. Body is otherwise identical to 0019.
create or replace function public.claim_scoring_work(batch_size integer default 12)
returns setof public.user_jobs
language sql
security definer
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

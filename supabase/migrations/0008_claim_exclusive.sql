-- Concurrent pg_cron ticks previously selected overlapping batches because a
-- plain subquery takes no row locks. SKIP LOCKED makes overlapping invocations
-- claim disjoint sets without blocking while preserving the 9-minute due
-- interval and per-minute polling cadence.
create or replace function public.claim_due_companies(batch_size integer default 10)
returns setof public.companies
language sql
security invoker
set search_path = ''
as $$
  with due as (
    select id
    from public.companies
    where last_polled_at is null
      or last_polled_at < now() - interval '9 minutes'
    order by last_polled_at asc nulls first
    limit batch_size
    for update skip locked
  )
  update public.companies c
  set last_polled_at = now()
  from due
  where c.id = due.id
  returning c.*;
$$;

revoke execute on function public.claim_due_companies(integer) from public, anon, authenticated;
grant execute on function public.claim_due_companies(integer) to service_role;

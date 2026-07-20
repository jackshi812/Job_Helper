-- Keep free scoring-pipeline work moving after the paid daily cap is exhausted.
-- Paid survivors are deferred to the next UTC budget day; cheap filtering and
-- exact semantic-hash reuse remain claimable and cost no OpenAI request.

alter table public.user_jobs
  add column score_deferred_until timestamptz;

revoke update (score_deferred_until) on public.user_jobs from authenticated;

-- A singleton request ledger makes cap admission atomic across overlapping Edge
-- Function invocations. ai_usage remains the token-accounting source of truth;
-- the ledger also counts reservations made immediately before a paid request,
-- including an in-flight request whose usage row has not been written yet.
create table public.score_request_budget (
  singleton boolean primary key default true check (singleton),
  budget_date date not null,
  requests_today integer not null check (requests_today >= 0),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.score_request_budget enable row level security;
revoke all on table public.score_request_budget from public, anon, authenticated;

insert into public.score_request_budget (singleton, budget_date, requests_today)
select
  true,
  (clock_timestamp() at time zone 'UTC')::date,
  count(*)::integer
from public.ai_usage as usage
where usage.purpose = 'score'
  and usage.occurred_at >= date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC';

create or replace function public.reserve_score_request(p_daily_cap integer)
returns table (
  reserved boolean,
  requests_today integer,
  budget_date date
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  utc_today date;
  ledger_date date;
  current_count integer;
  observed_usage integer;
begin
  if p_daily_cap <= 0 then
    raise exception 'score daily cap must be positive';
  end if;

  -- Lock before reading the clock/count so concurrent workers cannot both admit
  -- the last slot and a lock wait across UTC midnight uses the new budget day.
  select budget.budget_date, budget.requests_today
  into ledger_date, current_count
  from public.score_request_budget as budget
  where budget.singleton = true
  for update;

  if not found then
    raise exception 'score request budget row is missing';
  end if;

  utc_today := (clock_timestamp() at time zone 'UTC')::date;
  select count(*)::integer
  into observed_usage
  from public.ai_usage as usage
  where usage.purpose = 'score'
    and usage.occurred_at >= utc_today::timestamp at time zone 'UTC';

  if ledger_date is distinct from utc_today then
    ledger_date := utc_today;
    current_count := observed_usage;
  else
    current_count := greatest(current_count, observed_usage);
  end if;

  if current_count >= p_daily_cap then
    update public.score_request_budget
    set budget_date = ledger_date,
        requests_today = current_count,
        updated_at = clock_timestamp()
    where singleton = true;

    return query select false, current_count, ledger_date;
    return;
  end if;

  current_count := current_count + 1;
  update public.score_request_budget
  set budget_date = ledger_date,
      requests_today = current_count,
      updated_at = clock_timestamp()
  where singleton = true;

  return query select true, current_count, ledger_date;
end;
$$;

revoke execute on function public.reserve_score_request(integer)
  from public, anon, authenticated;
grant execute on function public.reserve_score_request(integer) to service_role;

-- A new preference or resume-routing revision must re-open even a paid-deferred
-- row so its free filter/reuse decision is recomputed under the new input.
create or replace function public.mark_recent_jobs_for_refilter()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.user_jobs as uj
  set needs_refilter = true,
      desired_input_revision = desired_input_revision + 1,
      attempts = 0,
      claimed_at = null,
      claimed_input_revision = null,
      score_deferred_until = null,
      error_code = null
  from public.jobs as j
  where uj.user_id = (select auth.uid())
    and uj.job_id = j.id
    and j.status = 'open';
end;
$$;

revoke execute on function public.mark_recent_jobs_for_refilter() from public, anon;
grant execute on function public.mark_recent_jobs_for_refilter() to authenticated;

create or replace function public.mark_user_jobs_for_reroute(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.user_jobs as uj
  set needs_refilter = true,
      desired_input_revision = desired_input_revision + 1,
      attempts = 0,
      claimed_at = null,
      claimed_input_revision = null,
      score_deferred_until = null,
      error_code = null
  from public.jobs as j
  where uj.user_id = p_user_id
    and uj.job_id = j.id
    and j.status = 'open';
end;
$$;

revoke execute on function public.mark_user_jobs_for_reroute(uuid)
  from public, anon, authenticated;
grant execute on function public.mark_user_jobs_for_reroute(uuid) to service_role;

-- Retain the 0025 verification latch while excluding paid-deferred rows until
-- their UTC rollover. SKIP LOCKED continues to prevent duplicate row claims.
create or replace function public.claim_scoring_work(
  batch_size integer default 12,
  verification_run_id uuid default null
)
returns setof public.user_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  active public.scoring_verification_maintenance%rowtype;
  has_active boolean;
  requested_run_id uuid := verification_run_id;
begin
  begin
    delete from public.scoring_verification_maintenance
    where expires_at <= now();
  exception when others then
    null;
  end;

  select m.* into active
  from public.scoring_verification_maintenance as m
  where m.expires_at > now()
  limit 1;
  has_active := found;

  if has_active then
    if requested_run_id is null or active.run_id <> requested_run_id then
      return;
    end if;

    return query
    with claimable as (
      select uj.id
      from public.user_jobs as uj
      where uj.id in (active.fixture_user_job_id_1, active.fixture_user_job_id_2)
        and (uj.status = 'pending' or uj.needs_refilter)
        and (uj.score_deferred_until is null or uj.score_deferred_until <= now())
        and uj.attempts < 5
        and (uj.claimed_at is null or uj.claimed_at < now() - interval '5 minutes')
      order by (uj.status = 'scored' and coalesce(uj.score, 0) >= 50) desc, (
        select j.first_seen_at from public.jobs as j where j.id = uj.job_id
      ) desc
      limit batch_size
      for update skip locked
    )
    update public.user_jobs as uj
    set claimed_at = now(),
        claimed_input_revision = uj.desired_input_revision,
        score_deferred_until = null,
        attempts = uj.attempts + 1
    from claimable
    where uj.id = claimable.id
    returning uj.*;
    return;
  end if;

  if requested_run_id is not null then
    return;
  end if;

  insert into public.user_jobs (user_id, job_id)
  select u.id, j.id
  from auth.users as u
  cross join public.jobs as j
  where j.status = 'open'
    and j.first_seen_at > now() - interval '30 days'
    and not exists (
      select 1 from public.user_jobs as uj
      where uj.user_id = u.id and uj.job_id = j.id
    )
  on conflict (user_id, job_id) do nothing;

  return query
  with claimable as (
    select uj.id
    from public.user_jobs as uj
    where (uj.status = 'pending' or uj.needs_refilter)
      and (uj.score_deferred_until is null or uj.score_deferred_until <= now())
      and uj.attempts < 5
      and (uj.claimed_at is null or uj.claimed_at < now() - interval '5 minutes')
    order by (uj.status = 'scored' and coalesce(uj.score, 0) >= 50) desc, (
      select j.first_seen_at from public.jobs as j where j.id = uj.job_id
    ) desc
    limit batch_size
    for update skip locked
  )
  update public.user_jobs as uj
  set claimed_at = now(),
      claimed_input_revision = uj.desired_input_revision,
      score_deferred_until = null,
      attempts = uj.attempts + 1
  from claimable
  where uj.id = claimable.id
  returning uj.*;
end;
$$;

revoke execute on function public.claim_scoring_work(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_scoring_work(integer, uuid) to service_role;

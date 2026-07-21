begin;

-- Capital One is the sole Workday identity authorized by this migration. Its
-- existing three clean server-timed observations are sufficient for activation,
-- but no other Workday tenant is admitted by either database or application
-- dispatch. The importer is intentionally selective and never closes jobs from
-- absence: Analysis/Finance, seven days, U.S., non-senior, <3 required years.

do $$
begin
  if exists (select 1 from public.jobs where source = 'workday') then
    raise exception 'Capital One activation requires zero pre-existing Workday jobs';
  end if;
end;
$$;

alter table public.companies
  drop constraint companies_workday_identity_check,
  add constraint companies_workday_identity_check check (
    ats_type <> 'workday'
    or (
      board_token = 'capitalone'
      and region = 'wd12'
      and site_token = 'Capital_One'
      and source_key = 'workday:wd12:capitalone:Capital_One'
      and activation_state in ('experimental', 'active')
    )
  );

-- Keep fresh installations correct too. record_connector_observation performs
-- all evidence validation before inserting this row; this trigger independently
-- re-checks the accepted evidence shape and promotes only the exact pinned source
-- after its third immutable ledger row. The enclosing RPC retains the resulting
-- active state when it writes activation_successes = 3.
create or replace function public.promote_capital_one_after_observation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.provider = 'workday'
    and new.completeness = 'complete'
    and new.credible_for_closure
    and new.warning_count = 0
    and new.job_count = new.expected_count
  then
    update public.companies as c
    set activation_state = 'active'
    where c.id = new.company_id
      and c.source_key = 'workday:wd12:capitalone:Capital_One'
      and c.board_token = 'capitalone'
      and c.region = 'wd12'
      and c.site_token = 'Capital_One'
      and c.activation_state = 'experimental'
      and (
        select count(*)
        from public.connector_observations as o
        where o.company_id = c.id
          and o.provider = 'workday'
          and o.completeness = 'complete'
          and o.credible_for_closure
          and o.warning_count = 0
          and o.job_count = o.expected_count
      ) = 3;
  end if;
  return new;
end;
$$;

revoke execute on function public.promote_capital_one_after_observation()
  from public, anon, authenticated;

drop trigger if exists promote_capital_one_after_observation
  on public.connector_observations;
create trigger promote_capital_one_after_observation
after insert on public.connector_observations
for each row execute function public.promote_capital_one_after_observation();

-- Promote the already-verified hosted row. Count the immutable ledger directly;
-- activation_successes is display state and is not trusted as the proof source.
update public.companies as c
set activation_state = 'active'
where c.source_key = 'workday:wd12:capitalone:Capital_One'
  and c.board_token = 'capitalone'
  and c.region = 'wd12'
  and c.site_token = 'Capital_One'
  and c.activation_state = 'experimental'
  and (
    select count(*)
    from public.connector_observations as o
    where o.company_id = c.id
      and o.provider = 'workday'
      and o.completeness = 'complete'
      and o.credible_for_closure
      and o.warning_count = 0
      and o.job_count = o.expected_count
  ) = 3;

-- Defense in depth: stable providers retain their existing flat allowlist and
-- Workday is admitted only through the exact Capital One identity. Activation
-- and staleness remain common conjuncts outside the provider disjunction.
create or replace function public.claim_due_companies(batch_size integer default 10)
returns setof public.companies
language sql
security invoker
set search_path = ''
as $$
  with due as (
    select id
    from public.companies
    where activation_state = 'active'
      and (
        ats_type in ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee')
        or (
          ats_type = 'workday'
          and source_key = 'workday:wd12:capitalone:Capital_One'
          and board_token = 'capitalone'
          and region = 'wd12'
          and site_token = 'Capital_One'
        )
      )
      and (
        last_polled_at is null
        or last_polled_at < now() - interval '9 minutes'
      )
    order by last_polled_at asc nulls first
    limit batch_size
    for update skip locked
  )
  update public.companies as c
  set last_polled_at = now()
  from due
  where c.id = due.id
  returning c.*;
$$;

revoke execute on function public.claim_due_companies(integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_companies(integer) to service_role;

comment on constraint companies_workday_identity_check on public.companies is
  'Only workday:wd12:capitalone:Capital_One may be Experimental or Active; no other Workday identity is admitted.';
comment on function public.claim_due_companies(integer) is
  'Claims active stable connectors plus the exact active Capital One Workday source; the Workday importer is selective and never closes on absence.';

commit;

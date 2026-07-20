-- Phase 03 gap closure: complete semantic freshness, monotonic worker CAS,
-- truthful source company identity, and a short-lived two-row verification latch.

alter table public.user_jobs
  add column scoring_input_hash text,
  add column desired_input_revision bigint not null default 0
    check (desired_input_revision >= 0),
  add column claimed_input_revision bigint
    check (claimed_input_revision is null or claimed_input_revision >= 0);

-- Pipeline freshness fields remain service-owned. Authenticated users retain only
-- the seen_at/dismissed_at column grant established by migration 0019.
revoke update (scoring_input_hash, desired_input_revision, claimed_input_revision)
  on public.user_jobs from authenticated;

alter table public.jobs
  add column source_company_name text,
  add constraint jobs_source_company_name_bounded
    check (
      source_company_name is null
      or (char_length(source_company_name) between 1 and 200
          and source_company_name = btrim(source_company_name))
    );

-- Existing tracked rows already have normalized company ownership. Copy only a
-- real nonblank name and bound it to the new source-name contract.
update public.jobs as j
set source_company_name = left(btrim(c.name), 200)
from public.companies as c
where j.company_id = c.id
  and nullif(btrim(c.name), '') is not null;

-- Preference changes apply to every existing own row whose shared job is still
-- open. Advancing the desired revision makes an older in-flight worker harmless;
-- resetting retries makes old and poison-capped rows safely reclaimable.
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
      error_code = null
  from public.jobs as j
  where uj.user_id = (select auth.uid())
    and uj.job_id = j.id
    and j.status = 'open';
end;
$$;

revoke execute on function public.mark_recent_jobs_for_refilter() from public, anon;
grant execute on function public.mark_recent_jobs_for_refilter() to authenticated;

-- Ready extraction changes can alter routing for every open row owned by that
-- user. This signal is service-only because the extraction worker supplies the
-- explicit owner id.
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

-- One active verification run may register exactly two already-existing rows.
-- The singleton and maximum TTL are enforced in the database. Deleting either
-- fixture cascades the latch away, which is another fail-safe release path.
create table public.scoring_verification_maintenance (
  singleton boolean primary key default true check (singleton),
  run_id uuid not null unique,
  fixture_user_job_id_1 uuid not null
    references public.user_jobs (id) on delete cascade,
  fixture_user_job_id_2 uuid not null
    references public.user_jobs (id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check (fixture_user_job_id_1 <> fixture_user_job_id_2),
  check (expires_at > created_at),
  check (expires_at <= created_at + interval '5 minutes')
);

alter table public.scoring_verification_maintenance enable row level security;
revoke all on table public.scoring_verification_maintenance from public, anon, authenticated;
grant select, insert, update, delete on table public.scoring_verification_maintenance
  to service_role;

create or replace function public.begin_scoring_verification(
  p_run_id uuid,
  p_fixture_user_job_id_1 uuid,
  p_fixture_user_job_id_2 uuid,
  p_ttl_seconds integer default 120
)
returns table (run_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  started_at timestamptz := clock_timestamp();
  fixture_count integer;
begin
  if p_run_id is null
    or p_fixture_user_job_id_1 is null
    or p_fixture_user_job_id_2 is null
    or p_fixture_user_job_id_1 = p_fixture_user_job_id_2 then
    raise exception 'invalid_scoring_verification_fixtures';
  end if;
  if p_ttl_seconds < 15 or p_ttl_seconds > 300 then
    raise exception 'invalid_scoring_verification_ttl';
  end if;

  select count(*) into fixture_count
  from public.user_jobs as uj
  where uj.id in (p_fixture_user_job_id_1, p_fixture_user_job_id_2);
  if fixture_count <> 2 then
    raise exception 'scoring_verification_fixture_missing';
  end if;

  return query
  insert into public.scoring_verification_maintenance as m (
    singleton,
    run_id,
    fixture_user_job_id_1,
    fixture_user_job_id_2,
    created_at,
    expires_at
  ) values (
    true,
    p_run_id,
    p_fixture_user_job_id_1,
    p_fixture_user_job_id_2,
    started_at,
    started_at + make_interval(secs => p_ttl_seconds)
  )
  on conflict (singleton) do update
  set run_id = excluded.run_id,
      fixture_user_job_id_1 = excluded.fixture_user_job_id_1,
      fixture_user_job_id_2 = excluded.fixture_user_job_id_2,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at
  where m.expires_at <= clock_timestamp()
  returning m.run_id, m.expires_at;

  if not found then
    raise exception 'scoring_verification_already_active';
  end if;
end;
$$;

create or replace function public.end_scoring_verification(p_run_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.scoring_verification_maintenance
  where run_id = p_run_id;
  get diagnostics removed = row_count;
  return removed = 1;
end;
$$;

revoke execute on function public.begin_scoring_verification(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke execute on function public.end_scoring_verification(uuid)
  from public, anon, authenticated;
grant execute on function public.begin_scoring_verification(uuid, uuid, uuid, integer)
  to service_role;
grant execute on function public.end_scoring_verification(uuid) to service_role;

-- Replace the old one-argument function rather than leaving an overload that
-- could bypass latch handling.
drop function public.claim_scoring_work(integer);

create function public.claim_scoring_work(
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
  -- Expired state is ignored even if this best-effort hygiene delete were ever
  -- to fail, so an abandoned verifier cannot block ordinary scoring past TTL.
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
        and uj.attempts < 5
        and (uj.claimed_at is null or uj.claimed_at < now() - interval '5 minutes')
      order by (
        select j.first_seen_at from public.jobs as j where j.id = uj.job_id
      ) desc
      limit batch_size
      for update skip locked
    )
    update public.user_jobs as uj
    set claimed_at = now(),
        claimed_input_revision = uj.desired_input_revision,
        attempts = uj.attempts + 1
    from claimable
    where uj.id = claimable.id
    returning uj.*;
    return;
  end if;

  -- A supplied id is verification intent. Without its active matching latch it
  -- always fails closed and never seeds ordinary work.
  if requested_run_id is not null then
    return;
  end if;

  -- Ordinary production behavior is unchanged when no latch and no id exist.
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
      and uj.attempts < 5
      and (uj.claimed_at is null or uj.claimed_at < now() - interval '5 minutes')
    order by (
      select j.first_seen_at from public.jobs as j where j.id = uj.job_id
    ) desc
    limit batch_size
    for update skip locked
  )
  update public.user_jobs as uj
  set claimed_at = now(),
      claimed_input_revision = uj.desired_input_revision,
      attempts = uj.attempts + 1
  from claimable
  where uj.id = claimable.id
  returning uj.*;
end;
$$;

revoke execute on function public.claim_scoring_work(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_scoring_work(integer, uuid) to service_role;

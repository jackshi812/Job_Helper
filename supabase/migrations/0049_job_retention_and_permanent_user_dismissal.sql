-- Bound job storage while keeping dismissal private to the acting user.
--
-- A dismissal removes the user's heavy user_jobs projection immediately. A
-- compact provider-identity tombstone survives shared job deletion so the same
-- provider job cannot be recreated for that user by scoring or ranking seeds.
-- Shared jobs remain available to other users.

create table public.user_job_dismissals (
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null,
  external_id text not null,
  dismissed_at timestamptz not null default clock_timestamp(),
  primary key (user_id, source, external_id)
);

alter table public.user_job_dismissals enable row level security;
revoke all on table public.user_job_dismissals from public, anon, authenticated;

-- Preserve existing user intent, then remove the old full projections.
insert into public.user_job_dismissals (
  user_id,
  source,
  external_id,
  dismissed_at
)
select
  user_job.user_id,
  job.source,
  job.external_id,
  user_job.dismissed_at
from public.user_jobs as user_job
join public.jobs as job on job.id = user_job.job_id
where user_job.dismissed_at is not null
on conflict (user_id, source, external_id) do update
set dismissed_at = least(
  public.user_job_dismissals.dismissed_at,
  excluded.dismissed_at
);

delete from public.user_jobs
where dismissed_at is not null;

create function public.prevent_dismissed_user_job_reinsert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.jobs as job
    join public.user_job_dismissals as dismissal
      on dismissal.user_id = new.user_id
     and dismissal.source = job.source
     and dismissal.external_id = job.external_id
    where job.id = new.job_id
  ) then
    return null;
  end if;

  return new;
end;
$$;

revoke execute on function public.prevent_dismissed_user_job_reinsert()
  from public, anon, authenticated;

create trigger prevent_dismissed_user_job_reinsert
before insert on public.user_jobs
for each row execute function public.prevent_dismissed_user_job_reinsert();

create function public.dismiss_job_permanently(p_user_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  dismissed_source text;
  dismissed_external_id text;
begin
  if owner_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select job.source, job.external_id
  into dismissed_source, dismissed_external_id
  from public.user_jobs as user_job
  join public.jobs as job on job.id = user_job.job_id
  where user_job.id = p_user_job_id
    and user_job.user_id = owner_id
  for update of user_job;

  if not found then
    return false;
  end if;

  insert into public.user_job_dismissals (user_id, source, external_id)
  values (owner_id, dismissed_source, dismissed_external_id)
  on conflict (user_id, source, external_id) do nothing;

  delete from public.user_jobs
  where id = p_user_job_id
    and user_id = owner_id;

  return found;
end;
$$;

revoke execute on function public.dismiss_job_permanently(uuid)
  from public, anon;
grant execute on function public.dismiss_job_permanently(uuid)
  to authenticated;

-- Closed jobs are permanently removed seven days after closure only when no
-- user has marked the job applied. Foreign keys cascade their remaining
-- user_jobs and ranking projections.
create function public.purge_closed_unapplied_jobs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  delete from public.jobs as job
  where job.status = 'closed'
    and job.closed_at is not null
    and job.closed_at <= clock_timestamp() - interval '7 days'
    and not exists (
      select 1
      from public.user_jobs as user_job
      where user_job.job_id = job.id
        and user_job.applied_at is not null
    );

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke execute on function public.purge_closed_unapplied_jobs()
  from public, anon, authenticated;
grant execute on function public.purge_closed_unapplied_jobs()
  to service_role;

create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'purge-closed-unapplied-jobs-daily';

select cron.schedule(
  'purge-closed-unapplied-jobs-daily',
  '17 4 * * *',
  $cron$select public.purge_closed_unapplied_jobs();$cron$
);

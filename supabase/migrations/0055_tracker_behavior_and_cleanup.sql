-- Repair the remaining Phase 04 hosted behavior boundaries:
-- 1. keep Dashboard projection invoker-safe without exposing the URL helper,
-- 2. permit final-event removal only as part of parent application deletion,
-- 3. remove the exact audited fake-job projection contamination.

begin;

create or replace function public.sync_application_stage_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_application_id uuid;
  target_owner_id uuid;
  latest_event public.application_stage_events%rowtype;
begin
  if tg_op = 'DELETE' then
    target_application_id := old.application_id;
    target_owner_id := old.user_id;
  else
    target_application_id := new.application_id;
    target_owner_id := new.user_id;
  end if;

  select event.* into latest_event
  from public.application_stage_events as event
  where event.application_id = target_application_id
    and event.user_id = target_owner_id
  order by event.occurred_on desc, event.created_at desc, event.id desc
  limit 1;

  if latest_event.id is null then
    if tg_op = 'DELETE' and not exists (
      select 1
      from public.applications as application
      where application.id = target_application_id
        and application.user_id = target_owner_id
    ) then
      return old;
    end if;
    raise exception
      'final_application_event: every application needs one timeline event';
  end if;

  update public.applications as application
  set current_stage = latest_event.stage,
      current_stage_date = latest_event.occurred_on,
      updated_at = clock_timestamp()
  where application.id = target_application_id
    and application.user_id = target_owner_id;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.sync_application_stage_projection()
  from public, anon, authenticated;
alter function public.sync_application_stage_projection() owner to postgres;

create or replace function public.dashboard_applied_applications()
returns table (
  application_id uuid,
  company text,
  title text,
  location text,
  apply_url text,
  applied_on date,
  current_stage text,
  current_stage_date date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    application.id as application_id,
    application.company,
    application.title,
    application.location,
    case
      when application.apply_url ~ '^https://[^/?#@]+(?:[/?#].*)?$'
      then application.apply_url
      else null
    end as apply_url,
    first_applied.occurred_on as applied_on,
    application.current_stage,
    application.current_stage_date
  from public.applications as application
  join lateral (
    select event.occurred_on
    from public.application_stage_events as event
    where event.application_id = application.id
      and event.user_id = application.user_id
      and event.stage = 'applied'
    order by event.occurred_on asc, event.created_at asc, event.id asc
    limit 1
  ) as first_applied on true
  where application.user_id = (select auth.uid())
    and application.origin = 'system'
  order by first_applied.occurred_on desc, application.id desc;
$$;

revoke execute on function public.dashboard_applied_applications()
  from public, anon;
grant execute on function public.dashboard_applied_applications()
  to authenticated;
alter function public.dashboard_applied_applications() owner to postgres;

do $cleanup$
declare
  unexpected_projection_id uuid;
  unexpected_projection_owner uuid;
  unexpected_projection_status text;
  unexpected_projection_attempts integer;
  unexpected_projection_count integer;
  ranking_item_count integer;
  ranking_pending_count integer;
  ranking_completed_count integer;
  ranking_claimed_count integer;
  ranking_failed_count integer;
  ranking_run_count integer;
  exact_count integer;
  changed_count integer;
begin
  select count(*) into exact_count
  from auth.users
  where id in (
    '04020000-0000-4000-8000-000000000001'::uuid,
    '04020000-0000-4000-8000-000000000002'::uuid
  );
  if exact_count <> 0 then
    raise exception 'cleanup guard: disposable auth users returned';
  end if;

  select
    (select count(*) from public.application_stage_events
     where user_id in (
       '04020000-0000-4000-8000-000000000001'::uuid,
       '04020000-0000-4000-8000-000000000002'::uuid
     ))
    + (select count(*) from public.applications
       where user_id in (
         '04020000-0000-4000-8000-000000000001'::uuid,
         '04020000-0000-4000-8000-000000000002'::uuid
       ))
    + (select count(*) from public.user_jobs
       where id in (
         '04020000-0000-4000-8000-000000000030'::uuid,
         '04020000-0000-4000-8000-000000000031'::uuid
       ))
    + (select count(*) from public.resumes
       where id in (
         '04020000-0000-4000-8000-000000000040'::uuid,
         '04020000-0000-4000-8000-000000000041'::uuid
       ))
  into exact_count;
  if exact_count <> 0 then
    raise exception 'cleanup guard: fixture-owner residue returned';
  end if;

  select count(*) into exact_count
  from storage.objects
  where owner_id::text in (
    '04020000-0000-4000-8000-000000000001',
    '04020000-0000-4000-8000-000000000002'
  ) or name like 'phase-04-tracker-0053-proof-v1/%';
  if exact_count <> 0 then
    raise exception 'cleanup guard: storage residue returned';
  end if;

  select count(*) into exact_count
  from public.companies
  where id = '04020000-0000-4000-8000-000000000010'::uuid
    and name = 'Phase 04 Tracker Fixture Company'
    and board_token = 'phase-04-tracker-0053-proof-v1'
    and careers_url =
      'https://job-boards.greenhouse.io/phase-04-tracker-0053-proof-v1'
    and source_key = 'greenhouse:global:phase-04-tracker-0053-proof-v1';
  if exact_count <> 1 then
    raise exception 'cleanup guard: fake company identity drifted';
  end if;

  perform 1
  from public.jobs
  where id = '04020000-0000-4000-8000-000000000020'::uuid
    and company_id = '04020000-0000-4000-8000-000000000010'::uuid
    and external_id = 'phase-04-tracker-0053-job'
    and fingerprint =
      'fd330e93bd57729fbd5c07a3d0ec8400f32b54ae7b8636bdb383af652b132b55'
    and status = 'open'
  for update;
  if not found then
    raise exception 'cleanup guard: fake job identity drifted';
  end if;

  update public.jobs
  set status = 'closed'
  where id = '04020000-0000-4000-8000-000000000020'::uuid
    and company_id = '04020000-0000-4000-8000-000000000010'::uuid
    and external_id = 'phase-04-tracker-0053-job'
    and status = 'open';
  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    raise exception 'cleanup guard: fake job close count drifted';
  end if;

  select
    count(*),
    (array_agg(user_job.id))[1],
    (array_agg(user_job.user_id))[1],
    min(user_job.status),
    min(user_job.attempts)
  into
    unexpected_projection_count,
    unexpected_projection_id,
    unexpected_projection_owner,
    unexpected_projection_status,
    unexpected_projection_attempts
  from public.user_jobs as user_job
  where user_job.job_id = '04020000-0000-4000-8000-000000000020'::uuid
    and user_job.id not in (
      '04020000-0000-4000-8000-000000000030'::uuid,
      '04020000-0000-4000-8000-000000000031'::uuid
    )
    and user_job.user_id not in (
      '04020000-0000-4000-8000-000000000001'::uuid,
      '04020000-0000-4000-8000-000000000002'::uuid
    );
  if unexpected_projection_count <> 1
    or unexpected_projection_status <> 'pending'
    or unexpected_projection_attempts <> 0 then
    raise exception 'cleanup guard: nonfixture projection drifted';
  end if;

  select count(*) into exact_count
  from auth.users
  where id = unexpected_projection_owner;
  if exact_count <> 1 then
    raise exception 'cleanup guard: projection owner is not active';
  end if;

  select count(*) into exact_count
  from public.applications
  where source_job_id = '04020000-0000-4000-8000-000000000020'::uuid;
  if exact_count <> 0 then
    raise exception 'cleanup guard: fake job gained applications';
  end if;

  select count(*) into exact_count
  from public.scoring_verification_maintenance
  where unexpected_projection_id in (
    fixture_user_job_id_1,
    fixture_user_job_id_2
  );
  if exact_count <> 0 then
    raise exception 'cleanup guard: projection entered scoring maintenance';
  end if;

  select
    count(*),
    count(*) filter (where item.status = 'pending'),
    count(*) filter (where item.status = 'completed'),
    count(*) filter (where item.status = 'claimed'),
    count(*) filter (where item.status = 'failed'),
    count(distinct item.run_id)
  into
    ranking_item_count,
    ranking_pending_count,
    ranking_completed_count,
    ranking_claimed_count,
    ranking_failed_count,
    ranking_run_count
  from public.deterministic_ranking_items as item
  where item.user_job_id = unexpected_projection_id
    and item.user_id = unexpected_projection_owner
    and item.job_id = '04020000-0000-4000-8000-000000000020'::uuid;
  if ranking_item_count < 1
    or ranking_item_count > 64
    or ranking_pending_count + ranking_completed_count <> ranking_item_count
    or ranking_claimed_count <> 0
    or ranking_failed_count <> 0
    or ranking_run_count <> ranking_item_count then
    raise exception 'cleanup guard: ranking item inventory drifted';
  end if;

  delete from public.user_jobs
  where id = unexpected_projection_id
    and user_id = unexpected_projection_owner
    and job_id = '04020000-0000-4000-8000-000000000020'::uuid
    and status = 'pending'
    and attempts = 0;
  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    raise exception 'cleanup guard: deleted_projection_count <> 1';
  end if;

  select count(*) into ranking_item_count
  from public.deterministic_ranking_items
  where job_id = '04020000-0000-4000-8000-000000000020'::uuid;
  if ranking_item_count <> 0 then
    raise exception 'cleanup guard: ranking item cascade incomplete';
  end if;

  delete from public.jobs
  where id = '04020000-0000-4000-8000-000000000020'::uuid
    and company_id = '04020000-0000-4000-8000-000000000010'::uuid
    and external_id = 'phase-04-tracker-0053-job'
    and status = 'closed';
  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    raise exception 'cleanup guard: fake job delete count drifted';
  end if;

  delete from public.companies
  where id = '04020000-0000-4000-8000-000000000010'::uuid
    and board_token = 'phase-04-tracker-0053-proof-v1'
    and source_key = 'greenhouse:global:phase-04-tracker-0053-proof-v1';
  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    raise exception 'cleanup guard: fake company delete count drifted';
  end if;
end
$cleanup$;

commit;

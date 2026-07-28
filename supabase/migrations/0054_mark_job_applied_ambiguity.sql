-- Repair the Phase 04 Mark Applied RPC without rewriting deployed migration 0053.
-- The former PL/pgSQL variable `application_id` collided with the event table's
-- `application_id` column and raised PostgreSQL 42702 at ordinary-session runtime.

create or replace function public.mark_job_applied(p_user_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  owned_job record;
  target_application_id uuid;
  latest_stage text;
begin
  if owner_id is null then raise exception 'authentication_required'; end if;
  if p_user_job_id is null then raise exception 'invalid_user_job_id'; end if;

  select
    user_job.id as user_job_id,
    user_job.job_id,
    job.title,
    job.location,
    job.absolute_url,
    job.description_html,
    job.description_text,
    job.snapshot_partial,
    coalesce(nullif(btrim(company.name), ''), nullif(btrim(job.source_company_name), ''))
      as company_name
  into owned_job
  from public.user_jobs as user_job
  join public.jobs as job on job.id = user_job.job_id
  left join public.companies as company on company.id = job.company_id
  where user_job.id = p_user_job_id
    and user_job.user_id = owner_id
  for update of user_job;

  if not found then raise exception 'user_job_not_found'; end if;
  if owned_job.company_name is null or btrim(owned_job.title) = '' then
    raise exception 'invalid_system_snapshot';
  end if;

  insert into public.applications (
    user_id, origin, source_job_id, company, title, location, apply_url,
    description_html, description_text, snapshot_partial,
    current_stage, current_stage_date
  ) values (
    owner_id, 'system', owned_job.job_id, owned_job.company_name,
    owned_job.title, owned_job.location,
    case
      when public.tracker_https_url_valid(owned_job.absolute_url)
      then owned_job.absolute_url
      else null
    end,
    owned_job.description_html, owned_job.description_text,
    owned_job.snapshot_partial, 'applied', current_date
  )
  on conflict (user_id, source_job_id) where origin = 'system'
  do nothing
  returning id into target_application_id;

  if target_application_id is null then
    select application.id into target_application_id
    from public.applications as application
    where application.user_id = owner_id
      and application.source_job_id = owned_job.job_id
      and application.origin = 'system'
    for update;
  end if;

  select event.stage into latest_stage
  from public.application_stage_events as event
  where event.application_id = target_application_id
    and event.user_id = owner_id
  order by event.occurred_on desc, event.created_at desc, event.id desc
  limit 1;

  if latest_stage is distinct from 'applied' then
    insert into public.application_stage_events (
      application_id, user_id, stage, occurred_on
    ) values (target_application_id, owner_id, 'applied', current_date);
  end if;

  update public.user_jobs as user_job
  set applied_at = coalesce(user_job.applied_at, clock_timestamp()),
      dismissed_at = null
  where user_job.id = p_user_job_id
    and user_job.user_id = owner_id;

  return target_application_id;
end;
$$;

revoke execute on function public.mark_job_applied(uuid)
  from public, anon;
grant execute on function public.mark_job_applied(uuid)
  to authenticated;
alter function public.mark_job_applied(uuid) owner to postgres;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Keep the eight-column Phase 04 RPC available to the currently deployed web
-- client while the new build rolls out. The new client switches to this
-- versioned projection only after the migration is present.
create function public.dashboard_applied_applications_v2()
returns table (
  application_id uuid,
  company text,
  title text,
  location text,
  apply_url text,
  applied_on date,
  current_stage text,
  current_stage_date date,
  has_watched_company boolean
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
    application.current_stage_date,
    exists (
      select 1
      from public.jobs as job
      join public.companies as company
        on company.id = job.company_id
      where job.id = application.source_job_id
    ) as has_watched_company
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

revoke all on function public.dashboard_applied_applications_v2()
  from public, anon, authenticated;
grant execute on function public.dashboard_applied_applications_v2()
  to authenticated;
alter function public.dashboard_applied_applications_v2() owner to postgres;

commit;

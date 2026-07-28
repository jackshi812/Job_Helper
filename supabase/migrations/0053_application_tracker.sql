begin;

-- Phase 04 Plan 01: one owner-scoped application aggregate and an immutable
-- chronological event ledger. This forward migration is intentionally local
-- until the separately approved Phase 04 release.

create or replace function public.tracker_https_url_valid(p_url text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select p_url ~ '^https://[^/?#@]+(?:[/?#].*)?$';
$$;
revoke execute on function public.tracker_https_url_valid(text)
  from public, anon, authenticated;

alter table public.resumes
  add constraint resumes_id_user_id_key unique (id, user_id);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  origin text not null,
  source_job_id uuid,
  company text not null,
  title text not null,
  location text,
  apply_url text,
  description_html text,
  description_text text,
  snapshot_partial boolean not null default false,
  notes text not null default '',
  pinned boolean not null default false,
  resume_id uuid,
  current_stage text not null,
  current_stage_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint applications_id_user_id_key unique (id, user_id),
  constraint applications_origin_check
    check (origin in ('system', 'manual')),
  constraint applications_stage_check check (
    current_stage in (
      'ready_to_apply',
      'applied',
      'outreach_sent',
      'interview',
      'offer',
      'rejected'
    )
  ),
  constraint applications_manual_fields_check check (
    (
      origin = 'system'
      and source_job_id is not null
      and btrim(company) <> ''
      and btrim(title) <> ''
    )
    or (
      origin = 'manual'
      and source_job_id is null
      and btrim(company) <> ''
      and btrim(title) <> ''
      and apply_url is not null
      and btrim(apply_url) <> ''
      and char_length(company) <= 200
      and char_length(title) <= 300
      and char_length(apply_url) <= 2048
      and char_length(coalesce(location, '')) <= 500
      and char_length(notes) <= 20000
      and char_length(coalesce(description_text, '')) <= 100000
      and description_html is null
      and snapshot_partial is false
    )
  ),
  constraint applications_job_url_check check (
    apply_url is null or public.tracker_https_url_valid(apply_url)
  ),
  constraint applications_resume_owner_fkey
    foreign key (resume_id, user_id)
    references public.resumes (id, user_id)
    on delete set null (resume_id)
);

create table public.application_stage_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  user_id uuid not null,
  stage text not null,
  occurred_on date not null,
  created_at timestamptz not null default now(),
  constraint application_stage_events_application_owner_fkey
    foreign key (application_id, user_id)
    references public.applications (id, user_id)
    on delete cascade,
  constraint application_stage_events_stage_check check (
    stage in (
      'ready_to_apply',
      'applied',
      'outreach_sent',
      'interview',
      'offer',
      'rejected'
    )
  )
);

create index applications_user_id_idx
  on public.applications (user_id);
create unique index applications_system_source_unique_idx
  on public.applications (user_id, source_job_id)
  where origin = 'system';
create index applications_pinned_updated_id_idx
  on public.applications (user_id, pinned desc, updated_at desc, id desc);
create index applications_resume_owner_idx
  on public.applications (resume_id, user_id)
  where resume_id is not null;
create index application_stage_events_user_id_idx
  on public.application_stage_events (user_id);
create index application_stage_events_application_order_idx
  on public.application_stage_events (
    application_id, occurred_on desc, created_at desc, id desc
  );

alter table public.applications enable row level security;
alter table public.application_stage_events enable row level security;

revoke all on table public.applications from anon, authenticated;
revoke all on table public.application_stage_events from anon, authenticated;
grant select on table public.applications to authenticated;
grant select on table public.application_stage_events to authenticated;

create policy "applications_select_own" on public.applications
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "application_stage_events_select_own"
  on public.application_stage_events
  for select to authenticated
  using ((select auth.uid()) = user_id);

create function public.sync_application_stage_projection()
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
    raise exception 'final_application_event: every application needs one timeline event';
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

create trigger application_stage_events_sync_projection
after insert or update or delete on public.application_stage_events
for each row execute function public.sync_application_stage_projection();

create function public.mark_job_applied(p_user_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  owned_job record;
  application_id uuid;
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
  returning id into application_id;

  if application_id is null then
    select application.id into application_id
    from public.applications as application
    where application.user_id = owner_id
      and application.source_job_id = owned_job.job_id
      and application.origin = 'system'
    for update;
  end if;

  select event.stage into latest_stage
  from public.application_stage_events as event
  where event.application_id = application_id
    and event.user_id = owner_id
  order by event.occurred_on desc, event.created_at desc, event.id desc
  limit 1;

  if latest_stage is distinct from 'applied' then
    insert into public.application_stage_events (
      application_id, user_id, stage, occurred_on
    ) values (application_id, owner_id, 'applied', current_date);
  end if;

  update public.user_jobs as user_job
  set applied_at = coalesce(user_job.applied_at, clock_timestamp()),
      dismissed_at = null
  where user_job.id = p_user_job_id
    and user_job.user_id = owner_id;

  return application_id;
end;
$$;

create function public.create_manual_application(
  p_company text,
  p_title text,
  p_apply_url text,
  p_notes text,
  p_stage text,
  p_occurred_on date
)
returns table (
  application_id uuid,
  duplicate_warning boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  created_id uuid;
  warning boolean;
begin
  if owner_id is null then raise exception 'authentication_required'; end if;
  if p_company is null or btrim(p_company) = ''
    or char_length(p_company) > 200 then
    raise exception 'invalid_application_company';
  end if;
  if p_title is null or btrim(p_title) = ''
    or char_length(p_title) > 300 then
    raise exception 'invalid_application_title';
  end if;
  if p_apply_url is null or btrim(p_apply_url) = ''
    or char_length(p_apply_url) > 2048
    or not public.tracker_https_url_valid(btrim(p_apply_url)) then
    raise exception 'invalid_application_url';
  end if;
  if p_notes is null or char_length(p_notes) > 20000 then
    raise exception 'invalid_application_notes';
  end if;
  if p_stage not in (
    'ready_to_apply', 'applied', 'outreach_sent',
    'interview', 'offer', 'rejected'
  ) then
    raise exception 'invalid_application_stage';
  end if;
  if p_occurred_on is null or p_occurred_on <> current_date then
    raise exception 'invalid_application_stage_date';
  end if;

  select exists (
    select 1
    from public.applications as application
    where application.user_id = owner_id
      and lower(btrim(application.company)) = lower(btrim(p_company))
      and lower(btrim(application.title)) = lower(btrim(p_title))
  ) into warning;

  insert into public.applications (
    user_id, origin, company, title, apply_url, notes,
    current_stage, current_stage_date
  ) values (
    owner_id, 'manual', btrim(p_company), btrim(p_title), btrim(p_apply_url),
    p_notes, p_stage, p_occurred_on
  )
  returning id into created_id;

  insert into public.application_stage_events (
    application_id, user_id, stage, occurred_on
  ) values (created_id, owner_id, p_stage, p_occurred_on);

  return query select created_id, warning;
end;
$$;

create function public.set_application_pin(
  p_application_id uuid,
  p_pinned boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  changed integer;
begin
  if owner_id is null then raise exception 'authentication_required'; end if;
  if p_application_id is null or p_pinned is null then
    raise exception 'invalid_application_pin';
  end if;
  update public.applications as application
  set pinned = p_pinned, updated_at = clock_timestamp()
  where application.id = p_application_id
    and application.user_id = owner_id;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'application_not_found'; end if;
  return true;
end;
$$;

create function public.update_application_text_field(
  p_application_id uuid,
  p_field text,
  p_value text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  application_origin text;
begin
  if owner_id is null then raise exception 'authentication_required'; end if;
  if p_application_id is null or p_field is null or p_value is null then
    raise exception 'invalid_application_field';
  end if;

  select application.origin into application_origin
  from public.applications as application
  where application.id = p_application_id
    and application.user_id = owner_id
  for update;
  if not found then raise exception 'application_not_found'; end if;

  if p_field = 'notes' then
    if char_length(p_value) > 20000 then raise exception 'invalid_application_notes'; end if;
    update public.applications set notes = p_value, updated_at = clock_timestamp()
    where id = p_application_id and user_id = owner_id;
  elsif application_origin = 'manual' and p_field = 'company' then
    if btrim(p_value) = '' or char_length(p_value) > 200 then
      raise exception 'invalid_application_company';
    end if;
    update public.applications set company = btrim(p_value), updated_at = clock_timestamp()
    where id = p_application_id and user_id = owner_id;
  elsif application_origin = 'manual' and p_field = 'title' then
    if btrim(p_value) = '' or char_length(p_value) > 300 then
      raise exception 'invalid_application_title';
    end if;
    update public.applications set title = btrim(p_value), updated_at = clock_timestamp()
    where id = p_application_id and user_id = owner_id;
  elsif application_origin = 'manual' and p_field = 'apply_url' then
    if char_length(p_value) > 2048
      or not public.tracker_https_url_valid(btrim(p_value)) then
      raise exception 'invalid_application_url';
    end if;
    update public.applications set apply_url = btrim(p_value), updated_at = clock_timestamp()
    where id = p_application_id and user_id = owner_id;
  elsif application_origin = 'manual' and p_field = 'location' then
    if char_length(p_value) > 500 then raise exception 'invalid_application_location'; end if;
    update public.applications
    set location = nullif(btrim(p_value), ''), updated_at = clock_timestamp()
    where id = p_application_id and user_id = owner_id;
  elsif application_origin = 'manual' and p_field = 'description_text' then
    if char_length(p_value) > 100000 then
      raise exception 'invalid_application_description';
    end if;
    update public.applications
    set description_text = nullif(p_value, ''), updated_at = clock_timestamp()
    where id = p_application_id and user_id = owner_id;
  else
    raise exception 'application_field_not_editable';
  end if;
  return true;
end;
$$;

create function public.set_application_resume(
  p_application_id uuid,
  p_resume_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  changed integer;
begin
  if owner_id is null then raise exception 'authentication_required'; end if;
  if p_resume_id is not null and not exists (
    select 1 from public.resumes as resume
    where resume.id = p_resume_id and resume.user_id = owner_id
  ) then
    raise exception 'resume_not_found';
  end if;
  update public.applications as application
  set resume_id = p_resume_id, updated_at = clock_timestamp()
  where application.id = p_application_id
    and application.user_id = owner_id;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'application_not_found'; end if;
  return true;
end;
$$;

create function public.append_application_stage(
  p_application_id uuid,
  p_stage text,
  p_occurred_on date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  created_id uuid;
begin
  if owner_id is null then raise exception 'authentication_required'; end if;
  if p_stage not in (
    'ready_to_apply', 'applied', 'outreach_sent',
    'interview', 'offer', 'rejected'
  ) then raise exception 'invalid_application_stage'; end if;
  if p_occurred_on is null or p_occurred_on <> current_date then
    raise exception 'invalid_application_stage_date';
  end if;
  if not exists (
    select 1 from public.applications as application
    where application.id = p_application_id and application.user_id = owner_id
  ) then raise exception 'application_not_found'; end if;
  insert into public.application_stage_events (
    application_id, user_id, stage, occurred_on
  ) values (p_application_id, owner_id, p_stage, p_occurred_on)
  returning id into created_id;
  return created_id;
end;
$$;

create function public.update_application_stage_event(
  p_event_id uuid,
  p_stage text,
  p_occurred_on date
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  changed integer;
begin
  if owner_id is null then raise exception 'authentication_required'; end if;
  if p_stage not in (
    'ready_to_apply', 'applied', 'outreach_sent',
    'interview', 'offer', 'rejected'
  ) or p_occurred_on is null or p_occurred_on > current_date then
    raise exception 'invalid_application_event';
  end if;
  update public.application_stage_events as event
  set stage = p_stage, occurred_on = p_occurred_on
  where event.id = p_event_id and event.user_id = owner_id;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'application_event_not_found'; end if;
  return true;
end;
$$;

create function public.delete_application_stage_event(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  changed integer;
begin
  if owner_id is null then raise exception 'authentication_required'; end if;
  delete from public.application_stage_events as event
  where event.id = p_event_id and event.user_id = owner_id;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'application_event_not_found'; end if;
  return true;
end;
$$;

-- Backfill every legacy applied row before browser consumers switch. The first
-- insert is idempotent on immutable system provenance; the event insert is
-- idempotent on application membership.
insert into public.applications (
  user_id, origin, source_job_id, company, title, location, apply_url,
  description_html, description_text, snapshot_partial,
  current_stage, current_stage_date, created_at, updated_at
)
select
  user_job.user_id,
  'system',
  user_job.job_id,
  coalesce(nullif(btrim(company.name), ''), nullif(btrim(job.source_company_name), '')),
  job.title,
  job.location,
  case
    when public.tracker_https_url_valid(job.absolute_url) then job.absolute_url
    else null
  end,
  job.description_html,
  job.description_text,
  job.snapshot_partial,
  'applied',
  user_job.applied_at::date,
  user_job.applied_at,
  user_job.applied_at
from public.user_jobs as user_job
join public.jobs as job on job.id = user_job.job_id
left join public.companies as company on company.id = job.company_id
where user_job.applied_at is not null
  and coalesce(nullif(btrim(company.name), ''), nullif(btrim(job.source_company_name), ''))
    is not null
on conflict (user_id, source_job_id) where origin = 'system'
do nothing;

insert into public.application_stage_events (
  application_id, user_id, stage, occurred_on, created_at
)
select
  application.id,
  user_job.user_id,
  'applied',
  user_job.applied_at::date,
  user_job.applied_at
from public.user_jobs as user_job
join public.applications as application
  on application.user_id = user_job.user_id
  and application.source_job_id = user_job.job_id
  and application.origin = 'system'
where user_job.applied_at is not null
  and not exists (
    select 1
    from public.application_stage_events as event
    where event.application_id = application.id
  );

-- Preserve the exact 0052 Dashboard page contract and attach only tracker
-- membership exclusion for Active rows.
alter function public.dashboard_feed_page(
  text, text, text[], text[], text, jsonb, integer
) rename to dashboard_feed_page_v0052;

create function public.dashboard_feed_page(
  p_lifecycle text,
  p_order text,
  p_tiers text[],
  p_hidden_company_keys text[],
  p_query_signature text,
  p_cursor jsonb default null,
  p_limit integer default 200
)
returns table (row_data jsonb, cursor_data jsonb, has_more boolean)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'authentication_required'; end if;
  return query
  select page.row_data, page.cursor_data, page.has_more
  from public.dashboard_feed_page_v0052(
    p_lifecycle, p_order, p_tiers, p_hidden_company_keys,
    p_query_signature, p_cursor, p_limit
  ) with ordinality as page(row_data, cursor_data, has_more, page_position)
  where p_lifecycle <> 'active'
    or not exists (
      select 1
      from public.applications as application
      join public.user_jobs as user_job
        on user_job.id = (page.row_data ->> 'id')::uuid
      where application.user_id = (select auth.uid())
        and application.origin = 'system'
        and application.source_job_id = user_job.job_id
    )
  order by page.page_position;
end;
$$;

create function public.dashboard_applied_applications()
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
      when public.tracker_https_url_valid(application.apply_url)
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

-- Direct applied_at writes are no longer lifecycle authority.
revoke all on table public.user_jobs from anon, authenticated;
grant select on table public.user_jobs to authenticated;
grant update (seen_at, dismissed_at) on public.user_jobs to authenticated;

revoke execute on function public.mark_job_applied(uuid)
  from public, anon;
grant execute on function public.mark_job_applied(uuid)
  to authenticated;
revoke execute on function public.create_manual_application(text, text, text, text, text, date)
  from public, anon;
grant execute on function public.create_manual_application(text, text, text, text, text, date)
  to authenticated;
revoke execute on function public.set_application_pin(uuid, boolean)
  from public, anon;
grant execute on function public.set_application_pin(uuid, boolean)
  to authenticated;
revoke execute on function public.update_application_text_field(uuid, text, text)
  from public, anon;
grant execute on function public.update_application_text_field(uuid, text, text)
  to authenticated;
revoke execute on function public.set_application_resume(uuid, uuid)
  from public, anon;
grant execute on function public.set_application_resume(uuid, uuid)
  to authenticated;
revoke execute on function public.append_application_stage(uuid, text, date)
  from public, anon;
grant execute on function public.append_application_stage(uuid, text, date)
  to authenticated;
revoke execute on function public.update_application_stage_event(uuid, text, date)
  from public, anon;
grant execute on function public.update_application_stage_event(uuid, text, date)
  to authenticated;
revoke execute on function public.delete_application_stage_event(uuid)
  from public, anon;
grant execute on function public.delete_application_stage_event(uuid)
  to authenticated;
revoke execute on function public.dashboard_applied_applications()
  from public, anon;
grant execute on function public.dashboard_applied_applications()
  to authenticated;
revoke execute on function public.dashboard_feed_page(
  text, text, text[], text[], text, jsonb, integer
) from public, anon;
grant execute on function public.dashboard_feed_page(
  text, text, text[], text[], text, jsonb, integer
) to authenticated;

alter function public.tracker_https_url_valid(text) owner to postgres;
alter function public.sync_application_stage_projection() owner to postgres;
alter function public.mark_job_applied(uuid) owner to postgres;
alter function public.create_manual_application(text, text, text, text, text, date)
  owner to postgres;
alter function public.set_application_pin(uuid, boolean) owner to postgres;
alter function public.update_application_text_field(uuid, text, text) owner to postgres;
alter function public.set_application_resume(uuid, uuid) owner to postgres;
alter function public.append_application_stage(uuid, text, date) owner to postgres;
alter function public.update_application_stage_event(uuid, text, date) owner to postgres;
alter function public.delete_application_stage_event(uuid) owner to postgres;
alter function public.dashboard_applied_applications() owner to postgres;
alter function public.dashboard_feed_page(
  text, text, text[], text[], text, jsonb, integer
) owner to postgres;

commit;

-- Jobs are shared system data (D-01): authenticated users may read every row,
-- while all writes are reserved for service-role ingestion functions. Third-party
-- description_html is stored but never rendered in Phase 2; Phase 3 must sanitize
-- it at render time with DOMPurify or an equivalent HTML sanitizer.
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete set null,
  source text not null check (source in ('greenhouse', 'lever', 'ashby', 'adzuna')),
  external_id text not null,
  title text not null,
  location text,
  absolute_url text not null,
  posted_at timestamptz,
  description_html text,
  description_text text,
  snapshot_partial boolean not null default false,
  fingerprint text not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (source, external_id)
);

alter table public.jobs enable row level security;

create index jobs_open_fingerprint_idx on public.jobs using btree (fingerprint)
  where status = 'open';
create index jobs_company_id_idx on public.jobs using btree (company_id);

revoke all on table public.jobs from anon, authenticated;
grant select on table public.jobs to authenticated;

create policy "jobs_select_shared" on public.jobs
  for select to authenticated
  using (true);

create table public.pipeline_heartbeat (
  id boolean primary key default true check (id),
  last_tick_at timestamptz,
  last_success_at timestamptz
);

insert into public.pipeline_heartbeat (id) values (true);

alter table public.pipeline_heartbeat enable row level security;

revoke all on table public.pipeline_heartbeat from anon, authenticated;
grant select on table public.pipeline_heartbeat to authenticated;

create policy "pipeline_heartbeat_select_shared" on public.pipeline_heartbeat
  for select to authenticated
  using (true);

create or replace function public.claim_due_companies(batch_size integer default 10)
returns setof public.companies
language sql
security invoker
set search_path = ''
as $$
  update public.companies
  set last_polled_at = now()
  where id in (
    select id
    from public.companies
    where last_polled_at is null
      or last_polled_at < now() - interval '9 minutes'
    order by last_polled_at asc nulls first
    limit batch_size
  )
  returning *;
$$;

revoke execute on function public.claim_due_companies(integer) from public, anon, authenticated;
grant execute on function public.claim_due_companies(integer) to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Phase 1 adopted publishable/secret keys, which are not JWTs and cannot satisfy
-- Edge Function JWT verification. poll-tick therefore disables verify_jwt and
-- authenticates this scheduler request with x-cron-secret. The secret exists only
-- in Vault and the Edge Function environment, preserving the same trust boundary.
-- The schedule stores this SQL before Vault is configured; early ticks fail closed.
select cron.schedule(
  'poll-tick-every-minute',
  '* * * * *',
  $cron$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'project_url'
    ) || '/functions/v1/poll-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'cron_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);

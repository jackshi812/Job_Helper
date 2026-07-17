-- These shared configuration rows are edited through the SQL editor until
-- Phase 3 preferences become the discovery query source.
create table public.seed_queries (
  id uuid primary key default gen_random_uuid(),
  owner_label text not null,
  what text not null,
  where_loc text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.seed_queries enable row level security;

revoke all on table public.seed_queries from anon, authenticated;
grant select on table public.seed_queries to authenticated;

create policy "seed_queries_select_shared" on public.seed_queries
  for select to authenticated
  using (true);

-- Replace these placeholder roles and locations in the SQL editor for the two
-- invited users. Keep the owner labels informational; discovery remains shared.
insert into public.seed_queries (owner_label, what, where_loc)
values
  ('User 1', 'software engineer', 'Chicago, IL'),
  ('User 1', 'data engineer', 'Chicago, IL'),
  ('User 2', 'product manager', 'Chicago, IL'),
  ('User 2', 'software engineer', 'Chicago, IL');

alter table public.pipeline_heartbeat
  add column adzuna_requests_today integer not null default 0,
  add column adzuna_budget_date date;

-- Hourly runs cap the four seeded searches at 96 requests/day. Even six rows
-- remain at 144 requests/day, leaving headroom beneath the 240 hard cutoff.
select cron.schedule(
  'discovery-sweep-hourly',
  '0 * * * *',
  $cron$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'project_url'
    ) || '/functions/v1/discovery-sweep',
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

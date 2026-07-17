-- Companies is a deliberately shared watchlist (D-01/D-02): either authenticated
-- user can read and modify every row. Shared policies use using (true) wherever
-- PostgreSQL permits it; insert uses the equivalent with check (true).
--
-- This table has no added_by column and is intentionally excluded from
-- delete_my_data(): companies are shared system data, not user-owned data.
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ats_type text not null check (ats_type in ('greenhouse', 'lever', 'ashby')),
  board_token text not null,
  region text check (region is null or region = 'eu'),
  last_polled_at timestamptz,
  last_success_at timestamptz,
  consecutive_failures integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  unique (ats_type, board_token)
);

alter table public.companies enable row level security;

create index companies_last_polled_at_idx on public.companies using btree (last_polled_at);

grant select, insert, update, delete on table public.companies to authenticated;

create policy "companies_select_shared" on public.companies
  for select to authenticated
  using (true);

create policy "companies_insert_shared" on public.companies
  for insert to authenticated
  with check (true);

create policy "companies_update_shared" on public.companies
  for update to authenticated
  using (true)
  with check (true);

create policy "companies_delete_shared" on public.companies
  for delete to authenticated
  using (true);

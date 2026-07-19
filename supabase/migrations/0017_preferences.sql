-- Preferences are strictly per-user (D-05): each authenticated user owns exactly
-- one preference row, enforced by user_id as the primary key. The job pool is
-- shared and global, but every user filters and scores it independently against
-- their own titles/locations/keywords, so this table carries per-user isolation
-- via own-row RLS on all four operations (the locked 0002_resumes.sql pattern):
-- no anon access, and insert/update `with check` binds the row to auth.uid() so
-- one user can never read or forge another user's preferences (T-3-01, T-3-03).
-- This row also holds the NOTF-03 notification-tuning columns (threshold default
-- 75 per D-07, quiet hours per D-19, digest time per D-20, IANA timezone) that
-- Plan 06's Settings UI will edit; they live here so Plan 06 only adds UI.
-- Array cardinality checks cap user-supplied filter input (T-3-02, ASVS V5).
create table public.preferences (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  titles text[] not null default '{}' check (cardinality(titles) <= 50),
  locations text[] not null default '{}' check (cardinality(locations) <= 50),
  include_keywords text[] not null default '{}' check (cardinality(include_keywords) <= 50),
  exclude_keywords text[] not null default '{}' check (cardinality(exclude_keywords) <= 50),
  notify_threshold integer not null default 75 check (notify_threshold between 0 and 100),
  quiet_start time,
  quiet_end time,
  digest_time time not null default '08:00',
  timezone text not null default 'America/Chicago',
  updated_at timestamptz not null default now()
);

alter table public.preferences enable row level security;

grant select, insert, update, delete on table public.preferences to authenticated;

create policy "preferences_select_own" on public.preferences
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "preferences_insert_own" on public.preferences
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "preferences_update_own" on public.preferences
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "preferences_delete_own" on public.preferences
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- 0022: fix mark_recent_jobs_for_refilter column-privilege denial.
--
-- user_jobs deliberately grants authenticated only UPDATE (seen_at, dismissed_at)
-- (0019 line 75) so users physically cannot alter their own score/tier. But
-- mark_recent_jobs_for_refilter (0019) was declared `security invoker` and granted
-- to authenticated, and it UPDATEs the needs_refilter column. Invoked by an
-- authenticated user (savePreferences, resume upload/delete) the UPDATE therefore
-- runs as that user and is rejected: 42501 "permission denied for table user_jobs".
-- The 0004 delete_my_data shape it copied works only because users hold DELETE on
-- their own rows via RLS; there is no analogous column grant for needs_refilter, by
-- design.
--
-- Flip it to `security definer` so the UPDATE runs as the function owner (which has
-- full table privilege), while the inner `where user_id = (select auth.uid())`
-- clause still confines every write to the calling user's own rows. auth.uid()
-- reads the request JWT GUC and is unaffected by the definer context, so the
-- user-scoping guarantee is preserved. search_path stays '' with fully
-- schema-qualified references, and execute remains granted to authenticated only
-- (revoked from public/anon) — unchanged from 0019. Body is otherwise identical.
--
-- mark_user_jobs_for_reroute is intentionally left as-is: it is service_role-only,
-- and service_role retains full privileges on user_jobs (0019 line 73 revokes only
-- from anon/authenticated), so it is not affected by the column grant.
create or replace function public.mark_recent_jobs_for_refilter()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.user_jobs
  set needs_refilter = true
  where user_id = (select auth.uid())
    and job_id in (
      select id from public.jobs where first_seen_at > now() - interval '7 days'
    );
end;
$$;

revoke execute on function public.mark_recent_jobs_for_refilter() from public, anon;
grant execute on function public.mark_recent_jobs_for_refilter() to authenticated;

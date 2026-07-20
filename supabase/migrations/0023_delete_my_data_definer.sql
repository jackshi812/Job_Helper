-- 0023: fix delete_my_data account-deletion permission denial (AUTH-04).
--
-- delete_my_data (0020) was declared `security invoker` and granted to
-- authenticated, mirroring 0004. But two of the tables it deletes from restrict
-- authenticated to less than DELETE:
--   * user_jobs   — grants only SELECT + UPDATE (seen_at, dismissed_at) (0019)
--   * notifications — grants only SELECT (0020 line 99)
-- Run as the invoking user, `delete from public.user_jobs ...` (and notifications)
-- is rejected with 42501 "permission denied for table user_jobs", so account
-- deletion fails partway and the user's data is not fully removed.
--
-- Flip it to `security definer` so the deletes run as the function owner (full
-- privilege) while every statement stays scoped to the caller via
-- `where user_id = (select auth.uid())`. auth.uid() reads the request JWT GUC and is
-- unaffected by the definer context, so no user can delete another user's data.
-- This deliberately does NOT widen the table grants: users still cannot DELETE their
-- scored user_jobs or notification ledger rows directly — only this vetted,
-- fully-scoped function can, as part of a complete account wipe. search_path stays
-- '' with schema-qualified references; execute stays granted to authenticated only.
-- Body is otherwise identical to 0020.
create or replace function public.delete_my_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.resumes
  where user_id = (select auth.uid());

  -- resume_extracts dies via FK cascade from resumes (0018 on delete cascade).

  delete from public.preferences
  where user_id = (select auth.uid());

  delete from public.user_jobs
  where user_id = (select auth.uid());

  delete from public.push_subscriptions
  where user_id = (select auth.uid());

  delete from public.notifications
  where user_id = (select auth.uid());
end;
$$;

revoke execute on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;

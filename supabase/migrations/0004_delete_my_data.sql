create or replace function public.delete_my_data()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.resumes
  where user_id = (select auth.uid());

  -- Phases 2-4 append their user-owned tables here.
end;
$$;

revoke execute on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;

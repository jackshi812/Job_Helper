begin;

create function public.delete_tracker_application(p_application_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  changed integer;
begin
  if owner_id is null then
    raise exception 'authentication_required';
  end if;

  delete from public.applications as application
  where application.id = p_application_id
    and application.user_id = owner_id;

  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'application_not_found';
  end if;

  return true;
end;
$$;

revoke all on function public.delete_tracker_application(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_tracker_application(uuid)
  to authenticated;
alter function public.delete_tracker_application(uuid) owner to postgres;

commit;

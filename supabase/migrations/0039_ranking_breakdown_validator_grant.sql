begin;

-- PostgreSQL re-evaluates the deterministic_breakdown CHECK constraint when an
-- authenticated owner updates lifecycle columns on user_jobs. The validator is
-- immutable, security-invoker SQL over only its JSON argument, so authenticated
-- callers need EXECUTE without any broader table or function privilege.
revoke execute on function public.is_valid_ranking_breakdown(jsonb)
  from public, anon;
grant execute on function public.is_valid_ranking_breakdown(jsonb)
  to authenticated;

do $$
begin
  if not has_function_privilege(
    'authenticated',
    'public.is_valid_ranking_breakdown(jsonb)',
    'execute'
  ) or has_function_privilege(
    'anon',
    'public.is_valid_ranking_breakdown(jsonb)',
    'execute'
  ) then
    raise exception 'ranking breakdown validator grant parity failed';
  end if;
end;
$$;

comment on function public.is_valid_ranking_breakdown(jsonb) is
  'Pure immutable JSON validator; authenticated EXECUTE is required only for user_jobs CHECK evaluation during owner lifecycle updates.';

commit;

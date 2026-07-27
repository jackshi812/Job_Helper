begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- PostgreSQL's regex engine rejects repetition bounds greater than 255.
-- Replace only Goldman's providerSourceId predicate while preserving every
-- sibling provider branch exactly as rendered by the hosted constraint.
do $migration$
declare
  v_definition text;
  v_old_predicate constant text :=
    '(scope_evidence ->> ''providerSourceId''::text) ~ ''^[0-9]{1,256}$''::text';
  v_new_predicate constant text :=
    '((scope_evidence ->> ''providerSourceId''::text) ~ ''^[0-9]+$''::text'
    || ' AND length(scope_evidence ->> ''providerSourceId''::text) >= 1'
    || ' AND length(scope_evidence ->> ''providerSourceId''::text) <= 256)';
begin
  select pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
  into v_definition
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.jobs'::regclass
    and constraint_row.conname = 'jobs_scope_evidence_check';

  if v_definition is null
    or (
      length(v_definition) - length(replace(v_definition, v_old_predicate, ''))
    ) / length(v_old_predicate) <> 1
  then
    raise exception 'exact Goldman providerSourceId regex baseline missing';
  end if;

  v_definition := replace(
    v_definition,
    v_old_predicate,
    v_new_predicate
  );

  alter table public.jobs drop constraint jobs_scope_evidence_check;
  execute
    'alter table public.jobs add constraint jobs_scope_evidence_check '
    || v_definition;
end;
$migration$;

commit;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Widen only Goldman's durable scope evidence from 168 to 720 hours while
-- preserving every sibling provider branch byte-for-byte as rendered by the
-- currently applied constraint.
do $migration$
declare
  v_definition text;
  v_old_hours constant text :=
    '(scope_evidence -> ''recentHours''::text) = ''168''::jsonb';
  v_new_hours constant text :=
    '(scope_evidence -> ''recentHours''::text) = ''720''::jsonb';
  v_old_digest constant text := 'to_json(168)::text';
  v_new_digest constant text := 'to_json(720)::text';
begin
  select pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
  into v_definition
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.jobs'::regclass
    and constraint_row.conname = 'jobs_scope_evidence_check';

  if v_definition is null
    or (
      length(v_definition) - length(replace(v_definition, v_old_hours, ''))
    ) / length(v_old_hours) <> 1
    or (
      length(v_definition) - length(replace(v_definition, v_old_digest, ''))
    ) / length(v_old_digest) <> 1
  then
    raise exception 'exact Goldman 168-hour jobs constraint baseline missing';
  end if;

  v_definition := replace(v_definition, v_old_hours, v_new_hours);
  v_definition := replace(v_definition, v_old_digest, v_new_digest);

  alter table public.jobs drop constraint jobs_scope_evidence_check;
  execute
    'alter table public.jobs add constraint jobs_scope_evidence_check '
    || v_definition;
end;
$migration$;

-- Keep Active Goldman jobs visible for the same rolling 30-day scope without
-- mutating provider lifecycle state.
do $migration$
declare
  v_definition text;
  v_old_interval constant text := 'interval ''168 hours''';
  v_new_interval constant text := 'interval ''720 hours''';
begin
  select pg_catalog.pg_get_functiondef(
    'public.dashboard_feed_page(text,text,text[],text[],text,jsonb,integer)'
      ::regprocedure
  )
  into v_definition;

  if v_definition is null
    or (
      length(v_definition) - length(replace(v_definition, v_old_interval, ''))
    ) / length(v_old_interval) <> 1
  then
    raise exception 'exact Goldman 168-hour feed baseline missing';
  end if;

  execute replace(v_definition, v_old_interval, v_new_interval);
end;
$migration$;

-- Refresh only the exact Goldman catalog candidate's scope description.
-- Preserve its prior Unsupported disposition until the new bounded probe earns
-- either fresh Experimental authority or a fresh precise Unsupported terminal.
do $migration$
declare
  v_rows integer;
begin
  update public.source_coverage_catalog
  set access_evidence =
        'Exact two-population Higher scope uses a rolling 30-day posting window plus page/count, detail, category, country, and Oracle Apply evidence.',
      verified_at = current_date
  where company_name = 'Goldman Sachs'
    and provider = 'Goldman Higher'
    and careers_url = 'https://higher.gs.com/results'
    and disposition = 'unsupported_with_reason'
    and unsupported_reason = 'posting_date_ineligible'
    and source_key is null;

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'exact Goldman Unsupported catalog baseline missing';
  end if;
end;
$migration$;

commit;

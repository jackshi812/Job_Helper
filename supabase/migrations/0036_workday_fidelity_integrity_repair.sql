begin;

-- Close the three-valued-logic gap left by 0035 and repair the persisted
-- Fidelity display/fingerprint identity. This migration is forward-only: the
-- deployed 0035 remains unchanged, and every probe/repair is in this transaction.

-- Preserve an explicit record of the admitted active rows across the repair.
-- The temporary table is discarded automatically at commit.
create temporary table migration_0036_active_workday_rows
on commit drop
as
select id, source_key
from public.companies
where activation_state = 'active'
  and source_key in (
    'workday:wd12:capitalone:Capital_One',
    'workday:wd1:fmr:FidelityCareers'
  );

-- An unexpected persisted Fidelity name or fingerprint prefix is identity
-- drift, not data that this migration may guess how to rewrite.
do $$
begin
  if exists (
    select 1
    from public.companies
    where source_key = 'workday:wd1:fmr:FidelityCareers'
      and name not in ('fmr', 'Fidelity')
  ) then
    raise exception 'unexpected Fidelity company name for exact source key';
  end if;

  if exists (
    select 1
    from public.jobs as j
    join public.companies as c
      on c.id = j.company_id
    where c.source_key = 'workday:wd1:fmr:FidelityCareers'
      and j.fingerprint not like 'fmr|%'
      and j.fingerprint not like 'fidelity|%'
  ) then
    raise exception 'unexpected Fidelity fingerprint prefix for exact source key';
  end if;
end;
$$;

-- PostgreSQL accepts a CHECK result of NULL. Require the two-tuple Workday
-- branch itself to evaluate to TRUE so nullable region/site_token cannot bypass
-- the exact allowlist.
alter table public.companies
  drop constraint companies_workday_identity_check,
  add constraint companies_workday_identity_check check (
    ats_type <> 'workday'
    or (
      (
        board_token = 'capitalone'
        and region = 'wd12'
        and site_token = 'Capital_One'
        and source_key = 'workday:wd12:capitalone:Capital_One'
        and activation_state in ('experimental', 'active')
      )
      or (
        board_token = 'fmr'
        and region = 'wd1'
        and site_token = 'FidelityCareers'
        and source_key = 'workday:wd1:fmr:FidelityCareers'
        and activation_state in ('experimental', 'active')
      )
    ) is true
  );

-- Exercise the installed public.companies constraint, not a regex facsimile.
-- Each inner block is a PostgreSQL subtransaction: the expected CHECK failure
-- rolls back its UPDATE/INSERT and execution continues. If a probe is accepted,
-- its explicit exception escapes and aborts the entire migration.
do $$
declare
  probe_suffix text := gen_random_uuid()::text;
begin
  begin
    update public.companies
    set region = null
    where source_key = 'workday:wd12:capitalone:Capital_One';

    if not found then
      insert into public.companies (
        name,
        ats_type,
        board_token,
        region,
        site_token,
        careers_url,
        source_key,
        activation_state
      ) values (
        'Migration 0036 null-region probe',
        'workday',
        'capitalone',
        null,
        'Capital_One',
        'https://capitalone.wd12.myworkdayjobs.com/Capital_One',
        'workday:wd12:capitalone:Capital_One',
        'active'
      );
    end if;

    raise exception 'NULL Workday region unexpectedly passed companies_workday_identity_check';
  exception
    when check_violation then
      null;
  end;

  begin
    update public.companies
    set site_token = null
    where source_key = 'workday:wd1:fmr:FidelityCareers';

    if not found then
      insert into public.companies (
        name,
        ats_type,
        board_token,
        region,
        site_token,
        careers_url,
        source_key,
        activation_state
      ) values (
        'Migration 0036 null-site probe',
        'workday',
        'fmr',
        'wd1',
        null,
        'https://wd1.myworkdaysite.com/en-US/recruiting/fmr/FidelityCareers',
        'workday:wd1:fmr:FidelityCareers',
        'active'
      );
    end if;

    raise exception 'NULL Workday site_token unexpectedly passed companies_workday_identity_check';
  exception
    when check_violation then
      null;
  end;

  begin
    insert into public.companies (
      name,
      ats_type,
      board_token,
      region,
      site_token,
      careers_url,
      source_key,
      activation_state
    ) values (
      'Migration 0036 unknown-tuple probe',
      'workday',
      'migration-probe-' || probe_suffix,
      'wd99',
      'Unknown_Site',
      'https://wd99.myworkdaysite.com/en-US/recruiting/migration-probe/Unknown_Site',
      'workday:wd99:migration-probe-' || probe_suffix || ':Unknown_Site',
      'active'
    );

    raise exception 'unknown Workday tuple unexpectedly passed companies_workday_identity_check';
  exception
    when check_violation then
      null;
  end;
end;
$$;

-- Repair only the exact frozen Fidelity source identity. Already-correct rows
-- remain unchanged.
update public.companies
set name = 'Fidelity'
where source_key = 'workday:wd1:fmr:FidelityCareers'
  and name = 'fmr';

-- The preflight proves the complete prefix set. Replacing four leading
-- characters preserves the title/location suffix byte-for-byte.
update public.jobs as j
set
  source_company_name = 'Fidelity',
  fingerprint = case
    when j.fingerprint like 'fmr|%'
      then 'fidelity|' || substring(j.fingerprint from 5)
    when j.fingerprint like 'fidelity|%'
      then j.fingerprint
    else j.fingerprint
  end
from public.companies as c
where c.id = j.company_id
  and c.source_key = 'workday:wd1:fmr:FidelityCareers';

-- Fail the transaction on repair drift, loss/deactivation of an admitted active
-- row, or loss of any identity uniqueness guarantee.
do $$
begin
  if exists (
    select 1
    from public.companies
    where source_key = 'workday:wd1:fmr:FidelityCareers'
      and name <> 'Fidelity'
  ) then
    raise exception 'Fidelity company-name repair parity failed';
  end if;

  if exists (
    select 1
    from public.jobs as j
    join public.companies as c
      on c.id = j.company_id
    where c.source_key = 'workday:wd1:fmr:FidelityCareers'
      and (
        j.source_company_name is distinct from 'Fidelity'
        or j.fingerprint not like 'fidelity|%'
      )
  ) then
    raise exception 'Fidelity job repair parity failed';
  end if;

  if exists (
    select 1
    from pg_temp.migration_0036_active_workday_rows as before_row
    left join public.companies as after_row
      on after_row.id = before_row.id
    where after_row.id is null
      or after_row.source_key <> before_row.source_key
      or after_row.activation_state <> 'active'
  ) then
    raise exception 'active Workday identity preservation parity failed';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.companies'::regclass
      and constraint_row.conname = 'companies_ats_type_board_token_key'
      and constraint_row.contype = 'u'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.companies'::regclass
      and constraint_row.conname = 'companies_source_key_key'
      and constraint_row.contype = 'u'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.jobs'::regclass
      and constraint_row.conname = 'jobs_source_external_id_key'
      and constraint_row.contype = 'u'
  ) then
    raise exception 'company/job unique-constraint parity failed';
  end if;
end;
$$;

comment on constraint companies_workday_identity_check on public.companies is
  'Exact Capital One/Fidelity Workday allowlist; the nullable identity branch must evaluate to TRUE.';

commit;

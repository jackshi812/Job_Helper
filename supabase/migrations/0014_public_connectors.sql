begin;

alter table public.companies
  drop constraint companies_ats_type_check,
  add constraint companies_ats_type_check check (
    ats_type in ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee')
  );

alter table public.jobs
  drop constraint jobs_source_check,
  add constraint jobs_source_check check (
    source in ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee', 'adzuna')
  );

-- Exercise every ingestion write shape while the migration is still transactional:
-- a normal insert, an exact-ID reopen, and a repost/source conversion.
do $$
declare
  probe_suffix text := gen_random_uuid()::text;
  probe_company_id uuid;
  probe_job_id uuid;
begin
  insert into public.companies (
    name,
    ats_type,
    board_token,
    careers_url,
    source_key,
    activation_state
  ) values (
    'Migration parity probe',
    'smartrecruiters',
    'migration-probe-' || probe_suffix,
    'https://jobs.smartrecruiters.com/MigrationProbe',
    'smartrecruiters:global:migration-probe-' || probe_suffix,
    'experimental'
  ) returning id into probe_company_id;

  insert into public.jobs (
    company_id,
    source,
    external_id,
    title,
    absolute_url,
    fingerprint,
    status
  ) values (
    probe_company_id,
    'smartrecruiters',
    'insert-' || probe_suffix,
    'Migration parity insert',
    'https://jobs.smartrecruiters.com/MigrationProbe/' || probe_suffix,
    'migration parity|insert|' || probe_suffix,
    'closed'
  ) returning id into probe_job_id;

  update public.jobs
  set status = 'open', closed_at = null, last_seen_at = now()
  where id = probe_job_id
    and source = 'smartrecruiters'
    and external_id = 'insert-' || probe_suffix;

  if not found then
    raise exception 'smartrecruiters exact-ID reopen parity failed';
  end if;

  update public.jobs
  set
    source = 'recruitee',
    external_id = 'converted-' || probe_suffix,
    last_seen_at = now()
  where id = probe_job_id;

  if not found or not exists (
    select 1
    from public.jobs
    where id = probe_job_id
      and source = 'recruitee'
      and external_id = 'converted-' || probe_suffix
  ) then
    raise exception 'recruitee repost/source-conversion parity failed';
  end if;

  delete from public.companies where id = probe_company_id;
  delete from public.jobs where id = probe_job_id;
end;
$$;

commit;

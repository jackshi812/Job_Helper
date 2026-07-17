-- A quota reservation can wait on the heartbeat lock across UTC midnight.
-- Read the clock only after the lock is held so the rollover date cannot be
-- stale by the time the ledger is inspected and updated.
create or replace function public.reserve_adzuna_request(
  p_effective_cutoff integer,
  p_hard_cutoff integer
)
returns table(
  reserved boolean,
  requests_today integer,
  budget_date date
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  utc_today date;
  ledger_date date;
  current_count integer;
  request_limit integer;
begin
  if p_effective_cutoff <= 0 or p_hard_cutoff <= 0 then
    raise exception 'Adzuna cutoffs must be positive';
  end if;

  request_limit := least(p_effective_cutoff, p_hard_cutoff);

  select heartbeat.adzuna_budget_date, heartbeat.adzuna_requests_today
  into ledger_date, current_count
  from public.pipeline_heartbeat as heartbeat
  where heartbeat.id = true
  for update;

  if not found then
    raise exception 'pipeline heartbeat row is missing';
  end if;

  utc_today := (clock_timestamp() at time zone 'UTC')::date;
  if ledger_date is distinct from utc_today then
    ledger_date := utc_today;
    current_count := 0;
  end if;

  if current_count >= request_limit then
    update public.pipeline_heartbeat
    set adzuna_budget_date = ledger_date,
        adzuna_requests_today = current_count
    where id = true;

    return query select false, current_count, ledger_date;
    return;
  end if;

  current_count := current_count + 1;
  update public.pipeline_heartbeat
  set adzuna_budget_date = ledger_date,
      adzuna_requests_today = current_count
  where id = true;

  return query select true, current_count, ledger_date;
end;
$$;

revoke execute on function public.reserve_adzuna_request(integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_adzuna_request(integer, integer)
  to service_role;

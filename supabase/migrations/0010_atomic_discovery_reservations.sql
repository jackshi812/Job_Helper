-- Serialize discovery admission and request accounting on the singleton
-- heartbeat row. Edge Function invocations can overlap even when pg_cron emits
-- only one tick, so read/compare/write in the function is not sufficient.
alter table public.pipeline_heartbeat
  add column last_discovery_slot text;

create or replace function public.admit_discovery_slot(p_slot text)
returns table(admitted boolean, admitted_slot text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_slot text;
begin
  if p_slot is null or btrim(p_slot) = '' then
    raise exception 'discovery slot is required';
  end if;

  select heartbeat.last_discovery_slot
  into current_slot
  from public.pipeline_heartbeat as heartbeat
  where heartbeat.id = true
  for update;

  if not found then
    raise exception 'pipeline heartbeat row is missing';
  end if;

  -- Slot keys use YYYY-MM-DDTHH:MM Chicago-local format, so lexical ordering
  -- also rejects a delayed older tick without allowing the latest slot twice.
  if current_slot is not null and p_slot <= current_slot then
    return query select false, current_slot;
    return;
  end if;

  update public.pipeline_heartbeat
  set last_discovery_slot = p_slot
  where id = true;

  return query select true, p_slot;
end;
$$;

revoke execute on function public.admit_discovery_slot(text) from public, anon, authenticated;
grant execute on function public.admit_discovery_slot(text) to service_role;

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
  utc_today date := (clock_timestamp() at time zone 'UTC')::date;
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

  if ledger_date is distinct from utc_today then
    ledger_date := utc_today;
    current_count := 0;
  end if;

  if current_count >= request_limit then
    -- Return the locked ledger value without spending a request.
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

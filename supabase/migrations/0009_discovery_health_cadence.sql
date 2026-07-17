-- Discovery uses 3 distinct seed queries x 21 sweeps = 63 requests/day:
-- every 30 minutes from 06:00 through 11:30 America/Chicago (12 sweeps), then
-- every two hours otherwise (9 sweeps). pg_cron invokes a lightweight gate
-- every 30 minutes; discovery-sweep calculates Chicago-local slots so DST does
-- not drift the window. Gated invocations spend zero Adzuna requests.
alter table public.pipeline_heartbeat
  add column last_discovery_at timestamptz,
  add column last_discovery_success_at timestamptz,
  add column discovery_status text check (discovery_status in ('ok', 'degraded', 'failed'));

do $$
begin
  perform cron.unschedule('discovery-sweep-hourly');
exception when others then
  null;
end
$$;

do $$
begin
  perform cron.unschedule('discovery-sweep-active');
exception when others then
  null;
end
$$;

do $$
begin
  perform cron.unschedule('discovery-sweep-overnight');
exception when others then
  null;
end
$$;

select cron.schedule(
  'discovery-sweep-schedule-gate',
  '*/30 * * * *',
  $cron$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'project_url'
    ) || '/functions/v1/discovery-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'cron_secret'
      )
    ),
    body := '{"scheduled":true}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);

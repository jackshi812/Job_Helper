-- Discovery uses 3 distinct seed queries x (64 active + 8 overnight sweeps)
-- = 216 requests/day, which stays beneath the 240 cutoff and the approximately
-- 250-request Adzuna free tier. The 11:00-02:59 UTC active window is about
-- 06:00-21:59 America/Chicago and delivers discovery every 15 minutes while
-- users are awake. Full-day 15-minute coverage would cost 288 requests/day,
-- so 03:00-10:59 UTC runs hourly by design. Phase 3 preference edits must keep
-- distinct queries x daily sweeps at or below 240.
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

select cron.schedule(
  'discovery-sweep-active',
  '*/15 11-23,0-2 * * *',
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
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);

select cron.schedule(
  'discovery-sweep-overnight',
  '0 3-10 * * *',
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
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);

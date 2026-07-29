begin;

-- Tracker stage dates are calendar dates, so every server-derived or
-- server-validated "today" must use the product's America/Chicago clock.
-- Function-local settings keep this deterministic regardless of the database
-- or caller session timezone.
alter function public.mark_job_applied(uuid)
  set timezone to 'America/Chicago';
alter function public.create_manual_application(text, text, text, text, text, date)
  set timezone to 'America/Chicago';
alter function public.append_application_stage(uuid, text, date)
  set timezone to 'America/Chicago';
alter function public.update_application_stage_event(uuid, text, date)
  set timezone to 'America/Chicago';

commit;

-- Remove the notification subsystem. Job matches remain available in the feed.

-- Stop enqueueing delivery work before removing its persistence and RPC.
select cron.unschedule(jobid)
from cron.job
where jobname = 'notify-tick-every-minute';

-- Keep account deletion valid after the notification tables disappear.
create or replace function public.delete_my_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.resumes
  where user_id = (select auth.uid());

  delete from public.preferences
  where user_id = (select auth.uid());

  delete from public.user_jobs
  where user_id = (select auth.uid());
end;
$$;

revoke execute on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;

drop function if exists public.claim_notifications(text, integer);
drop table if exists public.notifications;
drop table if exists public.push_subscriptions;

alter table public.preferences
  drop column if exists last_digest_date,
  drop column if exists notify_threshold,
  drop column if exists quiet_start,
  drop column if exists quiet_end,
  drop column if exists digest_time,
  drop column if exists timezone;

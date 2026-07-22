-- Phase 03.2: persisted maximum explicit required-experience preference.
alter table public.preferences
  add column max_required_experience integer
    check (max_required_experience is null or max_required_experience between 0 and 20);

alter table public.user_jobs
  drop constraint if exists user_jobs_filter_reason_check;

alter table public.user_jobs
  add constraint user_jobs_filter_reason_check
    check (filter_reason in (
      'excluded_keyword', 'wrong_location', 'title_non_overlap', 'experience_above_max'
    ));

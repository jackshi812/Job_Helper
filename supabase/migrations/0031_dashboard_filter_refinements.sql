-- Phase 03.3: additive title-only exclusions with rolling compatibility.
alter table public.preferences
  add column title_exclude_keywords text[] not null
    default array['president', 'PhD']::text[]
    check (cardinality(title_exclude_keywords) <= 50);

alter table public.user_jobs
  drop constraint if exists user_jobs_filter_reason_check;

alter table public.user_jobs
  add constraint user_jobs_filter_reason_check
    check (filter_reason in (
      'excluded_title_keyword',
      'excluded_keyword',
      'wrong_location',
      'title_non_overlap',
      'experience_above_max'
    ));

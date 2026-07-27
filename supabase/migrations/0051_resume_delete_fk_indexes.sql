-- Resume deletion uses ON DELETE SET NULL across both the legacy and
-- deterministic ranking columns. Without indexes, PostgreSQL scans the full
-- ranking tables for every resume FK and the authenticated delete request can
-- exceed the hosted statement timeout.

create index if not exists user_jobs_routed_resume_id_idx
  on public.user_jobs (routed_resume_id)
  where routed_resume_id is not null;

create index if not exists user_jobs_runner_up_resume_id_idx
  on public.user_jobs (runner_up_resume_id)
  where runner_up_resume_id is not null;

create index if not exists user_jobs_deterministic_best_fit_resume_id_idx
  on public.user_jobs (deterministic_best_fit_resume_id)
  where deterministic_best_fit_resume_id is not null;

create index if not exists user_jobs_deterministic_runner_up_resume_id_idx
  on public.user_jobs (deterministic_runner_up_resume_id)
  where deterministic_runner_up_resume_id is not null;

create index if not exists deterministic_ranking_items_best_fit_resume_id_idx
  on public.deterministic_ranking_items (deterministic_best_fit_resume_id)
  where deterministic_best_fit_resume_id is not null;

create index if not exists deterministic_ranking_items_runner_up_resume_id_idx
  on public.deterministic_ranking_items (deterministic_runner_up_resume_id)
  where deterministic_runner_up_resume_id is not null;

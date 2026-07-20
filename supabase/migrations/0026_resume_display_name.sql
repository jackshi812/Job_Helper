-- Optional, user-chosen display label for a resume.
-- Additive only: existing rows keep NULL so the UI falls back to `filename`.
-- `filename` remains the authoritative file identity for downloads, extension
-- validation, and storage-path construction; this column is cosmetic.
-- The four table-scoped resumes_* RLS policies already cover this new column.

alter table public.resumes
  add column display_name text;

# Deferred Items

## Plan 03.8-06

- `web/node_modules/.bin/supabase db lint --local` could not connect because the
  local Supabase/Postgres stack was not running. Static migration contracts and
  the full migration test suite passed; rerun the local lint when the stack is
  available.
- `npm run lint` passed with two pre-existing warnings in
  `web/src/auth/AuthProvider.tsx` (Fast Refresh export shape) and
  `web/src/lib/feed.ts` (control-character regex). Neither file was changed by
  this plan.
- Linked read-only migration parity and
  `supabase db push --linked --dry-run` remain root-only Plan 07 gates. They must
  show hosted `0001`–`0041` and propose exactly `0042`, then `0043`.

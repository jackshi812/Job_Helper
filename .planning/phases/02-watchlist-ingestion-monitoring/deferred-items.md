# Deferred Items

- `web/src/auth/AuthProvider.tsx:120` — existing `react(only-export-components)` fast-refresh lint warning; predates Plan 02-01 and is unrelated to watchlist work.
- The existing application bundle remains slightly above Vite's 500 kB chunk warning threshold; Plan 02-01 adds no dependency and code-splitting is outside this watchlist slice.

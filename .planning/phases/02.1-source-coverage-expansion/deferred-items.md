# Deferred Items

- **Watchlist removal can hang indefinitely while offline** — In production deployment `8b07ab41-46a3-4689-89bd-1c5326dc402e`, an offline Curi Capital deletion remained at `Removing…` with both modal actions disabled and no error alert. The row remained after safe recovery. The user accepted deferring a bounded timeout/cancellation fix and human UAT Checks 6-8. See `02.1-UAT.md` Check 5. This item is not passed and Phase 02.1 remains `gaps_found`.

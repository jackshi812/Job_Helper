---
status: testing
phase: 02-watchlist-ingestion-monitoring
source: [02-VERIFICATION.md]
started: 2026-07-17T19:17:00Z
updated: 2026-07-17T19:17:00Z
---

## Current Test

number: 1
name: Deployed Watchlist add, replace, and remove flow
expected: |
  The table and persisted state match each action; removal requires confirmation; re-adding the same supported board succeeds; unrelated captured jobs remain intact.
awaiting: user response

## Tests

### 1. Deployed Watchlist add, replace, and remove flow
expected: The table and persisted state match each action; removal requires confirmation; re-adding the same supported board succeeds; unrelated captured jobs remain intact.
result: [pending]

### 2. Health badge presentation in light and dark themes
expected: OK, Failing, and Stale are distinct and readable in both themes, and each badge's hover text reports the correct last-success context.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps

[none yet]

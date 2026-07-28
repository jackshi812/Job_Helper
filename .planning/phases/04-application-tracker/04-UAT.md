---
status: testing
phase: 04-application-tracker
source: [04-VERIFICATION.md]
started: 2026-07-28T16:56:12Z
updated: 2026-07-28T16:56:12Z
---

## Current Test

number: 1
name: Production Tracker renders
expected: |
  Refresh https://job-helper-qs9.pages.dev/tracker while signed in. The
  placeholder is gone. The page shows the Tracker description, Add position,
  six stage filters, and the horizontally scrollable application table or its
  real empty state.
awaiting: user response

## Tests

### 1. Production Tracker renders
expected: Refresh the signed-in production Tracker; the placeholder is gone and the real Tracker header, Add position action, six stage filters, and table or real empty state render.
result: pending

### 2. Manual tracking and detail editing persist
expected: Add a manual position, edit stage/date/notes, inspect its expanded timeline and details, optionally link a resume, reload, and observe the saved values and safe rendering.
result: pending

### 3. Dashboard and Tracker stay integrated
expected: Mark a Dashboard job applied, move it to Interview in Tracker, enable Show applied, and use View in Tracker; the current stage and focused row agree and opening Apply alone creates nothing.
result: pending

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps


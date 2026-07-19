---
phase: 03-scoring-feed-notifications
plan: 06
subsystem: push-enablement-and-alert-tuning
tags: [web-push, service-worker, notifications, settings, vapid, dead-subscription, quiet-hours, digest]
status: complete

requires:
  - phase: 03-scoring-feed-notifications (Plan 01)
    provides: "preferences table + web/src/lib/preferences.ts (loadPreferences/savePreferences) with notify_threshold/quiet_start/quiet_end/digest_time/timezone"
  - phase: 03-scoring-feed-notifications (Plan 05)
    provides: "push_subscriptions table (0020) — own-row RLS, unique(endpoint); notify-tick push/digest contract"
provides:
  - "web/public/sw.js — vanilla service worker: push + notificationclick (no build step, same-origin-validated navigation, focus-existing-tab)"
  - "web/src/lib/push.ts — enablePushOnThisDevice / disablePushOnThisDevice / getPushStatus / PushStatus / urlBase64ToUint8Array"
  - "web/src/pages/Settings.tsx — Notifications section (threshold slider, quiet-hours, digest-time, per-device push enable) + exported saveNotificationSettings/clampThreshold/pushErrorMessage"
  - "web/src/pages/Settings.test.ts — +5 tests (threshold clamp, array merge-not-overwrite, three bounded push reasons)"
affects:
  - "Plan 07 (provisions VITE_VAPID_PUBLIC_KEY + edge VAPID_KEYS, deploys notify-tick, and runs the live browser-push UAT this plan defers)"

tech-stack:
  added: []
  patterns:
    - "Vanilla service worker served from web/public at root scope (no build step, no fetch handler) — push display + navigation only (T-3-26)"
    - "Permission request strictly inside the button click handler; getPushStatus (no requestPermission) runs on mount as the dead-subscription health check"
    - "notificationclick resolves the target via new URL(url, self.location.origin) and rejects cross-origin before focus/openWindow (Codex SW-origin note)"
    - "Notification save loads then spreads existing filter arrays so titles/keywords are never overwritten — only threshold/quiet-hours/digest/timezone change (D-21)"

key-files:
  created:
    - web/public/sw.js
    - web/src/lib/push.ts
  modified:
    - web/src/pages/Settings.tsx
    - web/src/pages/Settings.test.ts

key-decisions:
  - "urlBase64ToUint8Array returns Uint8Array<ArrayBuffer> (explicit ArrayBuffer backing) so TS 6.0's generic-typed array satisfies the Push API applicationServerKey BufferSource type"
  - "getPushStatus treats 'browser has no subscription but DB has a stored row' OR 'Notification.permission === denied with a stored row' as dead-subscription (Pitfall 3), matching the plan's accepted endpoint/permission heuristic (device_id precision deferred)"
  - "pushErrorMessage collapses any non-bounded error to 'subscription failed' so the user never sees a raw error string; the three bounded reasons are the only ones surfaced verbatim"
  - "VITE_VAPID_PUBLIC_KEY is only referenced (import.meta.env, checked at call time); undefined key logs bounded code 'vapid_key_missing' and throws 'subscription failed' — no key hardcoded or generated (Plan 07 provisions it)"

requirements: [NOTF-01, NOTF-03]

coverage:
  - id: R1
    description: "User enables push from Settings ▸ Notifications with the permission prompt inside the button click; subscription upserts into push_subscriptions (NOTF-01 client side, D-21)"
    requirement: "NOTF-01"
    verification:
      - kind: other
        ref: "grep: Settings.tsx onClick={handleEnablePush} -> enablePushOnThisDevice() (no requestPermission in Settings/useEffect); push.ts register('/sw.js') -> Notification.requestPermission() -> pushManager.subscribe({userVisibleOnly,applicationServerKey}) -> from('push_subscriptions').upsert(onConflict 'endpoint')"
        status: pass
    human_judgment: true
    rationale: "Real permission grant + a live push-service subscription endpoint require a browser and the VAPID public key (Plan 07). Local proof is the click-gated call chain + upsert shape."
  - id: R2
    description: "User tunes instant-push threshold (slider, default 75), quiet hours, and digest send time from the same section (NOTF-03, D-21)"
    requirement: "NOTF-03"
    verification:
      - kind: tests
        ref: "web/src/pages/Settings.test.ts — clampThreshold 0–100 integer; saveNotificationSettings merge-not-overwrite (existing arrays + empty-row default)"
        status: pass
      - kind: other
        ref: "grep: Settings.tsx type=\"range\" min={0} max={100} default 75, three type=\"time\" inputs (quiet start/end + digest), timezone default via Intl.DateTimeFormat().resolvedOptions().timeZone"
        status: pass
    human_judgment: false
  - id: R3
    description: "Service worker shows pushes with the tab closed and click-through focuses an existing tab before opening /jobs/{id} or the feed (NOTF-01)"
    requirement: "NOTF-01"
    verification:
      - kind: other
        ref: "grep: sw.js addEventListener('push') -> showNotification inside event.waitUntil; addEventListener('notificationclick') -> matchAll -> focus existing same-origin client then navigate, else openWindow; target validated against self.location.origin"
        status: pass
    human_judgment: true
    rationale: "Tab-closed push receipt and click routing are observable only against a live push service + deployed notify-tick (Plan 07). Local proof is the listener composition + same-origin guard."
  - id: R4
    description: "A dead subscription is detected on app load and surfaced as the push-disabled notice (RESEARCH Pitfall 3)"
    requirement: "NOTF-01"
    verification:
      - kind: other
        ref: "grep: push.ts getPushStatus compares pushManager.getSubscription() endpoint vs stored push_subscriptions rows and returns 'dead-subscription' on stored-row + (no browser sub OR permission denied); Settings.tsx renders 'Push is disabled on this device. Strong matches fall back to email.' on that status via a mount-time getPushStatus effect"
        status: pass
    human_judgment: true
    rationale: "The dead-subscription transition depends on real browser subscription state; the local proof is the health-check logic + the notice wiring."

duration: 5min
completed: 2026-07-19
---

# Phase 3 Plan 06: Push Enablement & Alert Tuning Summary

**The browser half of NOTF-01/NOTF-03: a vanilla `web/public/sw.js` that displays notify-tick pushes with the tab closed and routes clicks to an already-open same-origin tab (falling back to a new window) after validating the target origin; a `web/src/lib/push.ts` client that registers the worker, requests permission strictly inside a user gesture, subscribes with the VAPID public key, and upserts the subscription into `push_subscriptions` — with a load-time `getPushStatus` health check that flags dead subscriptions; and a Settings ▸ Notifications card that tunes the instant-push threshold (slider, default 75), quiet hours, and digest send time without ever overwriting the user's matching-preference arrays.**

## Performance

- **Duration:** ~5 min
- **Tasks:** 2 (both auto)
- **Files created:** 2 · **Files modified:** 2

## Must-Have Verification

| Must-have | Evidence |
|-----------|----------|
| Enable push from Settings ▸ Notifications, permission prompt inside the button click; subscription lands in push_subscriptions (NOTF-01, D-21) | `Settings.tsx` `onClick={handleEnablePush}` → `enablePushOnThisDevice()`; **zero** `requestPermission` occurrences in Settings.tsx / no useEffect calls enablePush. `push.ts`: `register('/sw.js')` → `Notification.requestPermission()` → `pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: urlBase64ToUint8Array(VITE_VAPID_PUBLIC_KEY) })` → `from('push_subscriptions').upsert({ endpoint, subscription: sub.toJSON(), user_agent }, { onConflict:'endpoint' })` |
| Tune instant-push threshold (default 75), quiet hours, digest send time in the same section (NOTF-03, D-21) | `type="range" min={0} max={100}` with live `text-sm font-semibold` value + default 75; three `type="time"` inputs (quiet start/end + digest); timezone defaults to `Intl.DateTimeFormat().resolvedOptions().timeZone`; `saveNotificationSettings` persists via `savePreferences`. Unit tests: `clampThreshold` (150→100, -20→0, 74.6→75, NaN→75) and merge-not-overwrite both green |
| SW shows pushes tab-closed; click focuses an existing tab before opening /jobs/{id} or the feed (NOTF-01) | `sw.js` `push` listener → `self.registration.showNotification` inside `event.waitUntil`; `notificationclick` → `clients.matchAll({type:'window'})` → focus an existing same-origin client then `navigate(target.href)`, else `clients.openWindow`; `target` resolved via `new URL(url, self.location.origin)` and forced to origin root when cross-origin |
| Dead subscription detected on app load → push-disabled notice (Pitfall 3) | `getPushStatus` returns `'dead-subscription'` when a `push_subscriptions` row exists but the browser has no matching subscription, or `Notification.permission === 'denied'` with a stored row; a mount-time `useEffect` sets `pushStatus`, and Settings renders `Push is disabled on this device. Strong matches fall back to email.` |
| Files/exports exactly per plan frontmatter | `web/public/sw.js` (contains `notificationclick`), `web/src/lib/push.ts` (`enablePushOnThisDevice`/`getPushStatus`/`disablePushOnThisDevice` + `urlBase64ToUint8Array`/`PushStatus`), `web/src/pages/Settings.tsx` (contains `Enable push on this device`), `web/src/pages/Settings.test.ts` — all present |

## Local Gate Results (exact numbers)

- `cd web && npm run build` (tsc -b + vite) — **green** (only the pre-existing >500 kB chunk advisory; not introduced here).
- `cd web && npx vitest run src/pages/Settings.test.ts` — **1 file, 10 tests passed** (5 pre-existing + 5 new: threshold clamp, array merge-not-overwrite existing, array merge empty-row default, three bounded reasons, unbounded→subscription-failed collapse).
- `cd web && npx vitest run` — **27 files, 371 tests passed** (Plan 05 baseline 27/366; +5 new Settings tests, no file count change).
- `cd web && npm run lint` (oxlint) — **green**; sole remaining warning is the pre-existing `AuthProvider.tsx:120` (out of scope, untouched). The two `_err` unused-catch warnings introduced during Task 1 were cleared to optional catch bindings before the Task 2 commit.
- Acceptance greps: `notificationclick` ✓, `userVisibleOnly` ✓, `onConflict: 'endpoint'` ✓, three bounded reasons verbatim ✓, `type="range"` min 0/max 100 ✓, three `type="time"` inputs ✓, exact label `Enable push on this device` ✓, `requestPermission` count in Settings.tsx = 0 ✓.

## Task Commits

1. **Task 1 — vanilla push service worker + browser push client** — `ae324e3` (feat)
2. **Task 2 — Settings ▸ Notifications tuning + per-device push enable** — `3211866` (feat)

## Deviations from Plan

None — plan executed exactly as written.

### Implementation note (within-task, not a plan deviation)

- **TS 6.0 generic `Uint8Array`.** The initial `urlBase64ToUint8Array` returned a `Uint8Array<ArrayBufferLike>`, which TS 6.0 refuses to assign to the Push API's `applicationServerKey: BufferSource` (the `SharedArrayBuffer` branch of `ArrayBufferLike` is not an `ArrayBuffer`). Fixed before the Task 1 commit by allocating an explicit `new ArrayBuffer(...)` and annotating the return type `Uint8Array<ArrayBuffer>`. No behavior change; the byte content is identical.

## Authentication Gates

None. All work is local client code + unit tests; no live push, no permission grant, no deploy, no VAPID generation was attempted (per the plan's autonomous local-only boundary).

## Safety Boundary Compliance

- No migrations touched; no 02.1-owned files edited. `push_subscriptions` (0020) consumed read/write via the browser client only — not altered.
- Permission request lives strictly inside the `Enable push on this device` click handler (`requestPermission` count in Settings.tsx = 0; the mount-time effect calls only `getPushStatus`).
- `notificationclick` never passes an unvalidated cross-origin URL to `navigate`/`openWindow` — the target is resolved against `self.location.origin` and forced to the origin root when cross-origin.
- `VITE_VAPID_PUBLIC_KEY` is referenced via `import.meta.env` only (checked at call time); no key hardcoded, no VAPID keygen run — provisioning is Plan 07.
- Left `.DS_Store`, `scripts/agent-dashboard.mjs`, `scripts/agent-dashboard.test.mjs` untracked/unstaged; did not edit `STATE.md`.

## Known Stubs

None. Every control persists real preference data and the push client performs real register/subscribe/upsert/delete calls. The only intentionally deferred dependency is the `VITE_VAPID_PUBLIC_KEY` value itself (Plan 07) — its absence is handled with a bounded error, not a stub.

## Issues Encountered

None. Local gate (build + 371 tests + lint) green after clearing the two self-introduced unused-catch lint warnings.

## Next Phase Readiness

- **Deferred to Plan 07 (live browser-push UAT):** provision `VITE_VAPID_PUBLIC_KEY` (SPA) + edge `VAPID_KEYS`, push `0020` to the hosted DB, deploy `notify-tick`, then prove end-to-end — real permission grant, a live push-service subscription landing in `push_subscriptions`, a tab-closed push showing via `sw.js`, click-through focusing an existing tab to `/jobs/{id}` (or the feed for a collapsed push), and a genuine dead-subscription transition surfacing the push-disabled notice. **No live external push/subscribe was performed here** — this plan ships the browser client and UI only.

## Self-Check: PASSED

All 4 plan-frontmatter files exist on disk (`web/public/sw.js`, `web/src/lib/push.ts`, `web/src/pages/Settings.tsx`, `web/src/pages/Settings.test.ts`); both task commits (`ae324e3`, `3211866`) are present in git log; local gate (build + 371 tests + lint) is green.

---
*Phase: 03-scoring-feed-notifications*
*Completed: 2026-07-19*

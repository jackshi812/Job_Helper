# Phase 3: Scoring, Feed & Notifications - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-18
**Phase:** 3-scoring-feed-notifications
**Areas discussed:** Filter & preference semantics, Scoring & match reasons, Feed & job detail UX, Notification behavior

---

## Filter & preference semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Fuzzy word-overlap | Normalize + significant word overlap + synonyms; AI judges after | ✓ |
| Strict substring | Verbatim phrase match; misses reworded titles | |
| Titles advisory only | Never discard on title alone | |

**User's choice:** Fuzzy word-overlap (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Excludes hard, includes soft | Exclude keyword discards; include keywords boost only | ✓ |
| Both hard | Must contain include AND no exclude | |
| Both soft | Keywords only feed AI prompt | |

**User's choice:** Excludes hard, includes soft (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Allow-list + remote + unknown pass | Pass on preferred location, remote, or blank/ambiguous; discard clear mismatches | ✓ |
| Strict allow-list | Blank/ambiguous discarded | |
| Location advisory only | Never discard on location | |

**User's choice:** Allow-list + remote + unknown pass (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Keep with status, browsable | Filtered rows kept with reason; "all jobs" toggle; re-filter on preference change | ✓ |
| Keep status, no re-filter | Status stored; edits apply to new jobs only | |
| Feed only shows survivors | No filtered visibility | |

**User's choice:** Keep with status, browsable (Recommended)

---

## Scoring & match reasons

| Option | Description | Selected |
|--------|-------------|----------|
| 0-100 + tier label | Numeric + Strong/Good/Weak | ✓ |
| Tiers only | Coarser threshold tuning | |
| 0-100 only | No labels | |

**User's choice:** 0-100 + tier label (Recommended)

**Resume selection:** Initial question (single default resume vs best-of-all vs most-recent) was interrupted — user clarified they keep 3 resumes (data scientist, finance, data engineer) and want the system to recommend which to use per job based on keywords.

| Option | Description | Selected |
|--------|-------------|----------|
| Cheap keyword routing + 1 AI score | Extract keywords per resume at upload; overlap routes; AI scores routed resume only | ✓ |
| AI scores all 3 resumes | 3x calls, per-resume scores | |
| Hybrid: keyword route, AI verify close calls | AI scores both on near-tie | |

**User's choice:** Cheap keyword routing + 1 AI score (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Rescore recent window | ~7 days still-open jobs rescored on resume/preference change | ✓ |
| New jobs only | Existing scores frozen | |
| Manual rescore button | User-triggered | |

**User's choice:** Rescore recent window (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| 3-5 short bullets | Structured: skill overlap, title fit, location, resume hooks | ✓ |
| One sentence summary | Tersest | |
| Bullets + concern flags | Adds explicit misgivings | |

**User's choice:** 3-5 short bullets (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Strong ≥75, Good 50-74, Weak <50 | Conventional split, threshold default 75 | ✓ |
| Claude decides after calibration | Provisional cutoffs, config-stored | |
| User-defined cutoffs | Settings sliders | |

**User's choice:** Strong ≥75, Good 50-74, Weak <50 (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Full JD + resume summary | One-time resume summarization pass | |
| Full JD + full resume text | Max fidelity, ~2-3x tokens, still cheap | ✓ |
| Truncated JD + resume summary | Cheapest | |

**User's choice:** Full JD + full resume text

**Model discussion:** User asked which model API; explored OpenAI options (gpt-5-mini/nano); user noted they hold Gemini Pro + ChatGPT Pro subscriptions — clarified subscriptions don't cover API usage. User set budget "can have some cost, <$5/month". User asked whether chosen models suffice — assessment: yes, no upgrade necessary; extraction bumped to Flash; Pro reserved as stage-2 valve.

**Final model plan:** Gemini 2.5 Flash = scorer + resume keyword extraction; Gemini 2.5 Flash-Lite = triage; all paid tier; optional Gemini 2.5 Pro stage-2 rescore of Strong matches as config valve; no OpenAI. ~$3/month.

---

## Feed & job detail UX

| Option | Description | Selected |
|--------|-------------|----------|
| Newest first, score visible | Recency sort, score/tier column, header re-sort | ✓ |
| Score first | Best matches top | |
| Tier sections, recency within | Hybrid layout | |

**User's choice:** Newest first, score visible (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| New badge + dismiss | Unseen badge; dismiss hides (recoverable); per-user state | ✓ |
| Auto-mark-seen only | Nothing hideable | |
| Full read/dismiss/star | Star overlaps Phase 4 tracker | |

**User's choice:** New badge + dismiss (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Strong + Good, Weak behind toggle | Default ≥50; Weak + filtered behind "all jobs" toggle | ✓ |
| Everything scored | All survivors visible | |
| Strong only | Ultra-tight | |

**User's choice:** Strong + Good, Weak behind toggle (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Categorized gap lists | Missing-from-resume grouped by skills/tools/certs/domain + covered list | ✓ |
| Flat missing-keywords list | Ungrouped | |
| Inline JD highlighting | Highlight in JD text | |

**User's choice:** Categorized gap lists (Recommended)

---

## Notification behavior

**Cadence:** First question (per-match burst-collapsed vs strict per-match vs 15-min digest) answered free-text: "one notification per day". Tension with 5–15 min core promise surfaced; user then chose the hybrid.

| Option | Description | Selected |
|--------|-------------|----------|
| Daily digest only | One push + email per day; instant-alert promise relaxed | |
| Instant for Strong, daily digest for rest | Instant push ≥75 only; digest covers rest | ✓ |
| Daily digest + higher instant bar | Instant only ≥90 | |

**User's choice:** Instant for Strong, daily digest for rest (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Delay to morning | Quiet-hours matches queue, fire combined push at quiet end | ✓ |
| Suppress, catch in digest | Night matches skip push | |
| No quiet hours | Push 24/7 | |

**User's choice:** Delay to morning (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Daily digest + push-failure backup | Digest email + individual fallback email on failed Strong push | ✓ |
| Digest only | Push failures invisible until digest | |
| Email mirrors every instant push | Redundant | |

**User's choice:** Daily digest + push-failure backup (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Settings page section | Threshold slider, quiet hours, digest time, per-device push enable in Settings | ✓ |
| Preferences page with job prefs | Alert knobs beside titles/locations/keywords | |
| Split | Threshold with prefs, rest in Settings | |

**User's choice:** Settings page section (Recommended)

---

## Claude's Discretion

- Fuzzy title-match algorithm specifics (tokenization, synonym table, overlap threshold)
- Keyword-extraction prompt/schema; routing tie-break threshold
- Scoring rubric wording, JSON schema, calibration checks
- Preferences page layout/UX
- Push permission onboarding, service-worker structure, notification click-through
- Digest email layout; delivery bookkeeping
- Whether Flash-Lite triage stage is kept or dropped if cheap filters suffice

## Deferred Ideas

- Star/shortlist feed state — Phase 4 tracker
- Score-against-all-3-resumes comparison view — only if routing misroutes
- Gemini 2.5 Pro stage-2 rescore — config valve on evidence

# Feature Research

**Domain:** Job-discovery + AI resume-tailoring copilot (job-search copilot / job tracker category)
**Researched:** 2026-07-15
**Confidence:** MEDIUM (competitor features cross-verified across vendor sites + independent reviews; user-sentiment claims from secondary review roundups are LOW)

## Competitor Landscape (context for categorization)

| Product | Core Identity | What Users Actually Rely On |
|---------|---------------|------------------------------|
| **Teal** | Job tracker + resume tools ("CRM for job search") | One-click save from 50+ boards into a single tracker; table view with pipeline overview; notes/reminders per job. Complaints: feature overload, AI hard/soft-skill suggestions frequently wrong. |
| **Simplify** | Autofill-first Chrome extension + tracker | Autofill on 100+ portals (Workday/Greenhouse/iCIMS/Lever); applied jobs auto-added to tracker; missing-keyword overlay on LinkedIn/Indeed listings. Built for high-volume applying. |
| **Huntr** | Visual kanban tracker + resume builder | Drag-drop kanban stages; one-click job capture via extension; JD-based resume tailoring. Free tier capped at 40 jobs. |
| **Jobscan** | Resume-vs-JD match scoring | Match rate score (target 75+), categorized missing-keyword lists, ATS formatting warnings. Scan → fix → rescan loop. |
| **HiringCafe** | Fresh aggregator sourced directly from career pages | No ghost/stale listings (jobs vanish when closed at source), deduped, links straight to company apply page. Criticized for only ~2x/day refresh. |
| **Scoutify / OpenJobRadar / Jobstrack** | Career-page monitoring niche | Watch specific companies' Greenhouse/Lever/Ashby/Workday pages; push/email alerts within minutes. This niche exists precisely because incumbent alerts (LinkedIn, MyGreenhouse) are daily/weekly batches. |

**Key market insight:** the category splits into three jobs-to-be-done — *find fast* (monitoring tools), *apply fast* (Simplify autofill, Jobscan tailoring), *stay organized* (Teal/Huntr trackers). No mainstream tool does all three well; this product's v1 deliberately combines find-fast + tailor + lightweight tracking.

## Feature Landscape

### Table Stakes (Users Expect These)

Missing these = product feels incomplete relative to Teal/Simplify/Huntr/monitoring tools.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Match feed with job card basics (title, company, location, posted-time, link to original posting) | Every competitor shows this; "posted X min ago" is the whole point of a fast-alert product | LOW | Link must go to the company's own apply page (HiringCafe pattern users praise) |
| Deduplication across sources | Duplicate listings are the #1 complaint about aggregators; HiringCafe's dedupe is a cited selling point | MEDIUM | Dedupe watchlist ATS hits vs aggregator hits (same job, two sources); fuzzy match on company+title+location |
| Per-user preferences (titles, locations, keywords) driving the feed | All monitoring tools and aggregators filter on these; without it the feed is noise | LOW | Cheap-filter layer; also the input to AI scoring |
| Email alerts for new matches | Baseline notification channel everywhere (even Greenhouse native does daily email) | LOW | The differentiator is latency, not the channel itself |
| Application pipeline stages (saved → applied → interview → rejected → offer) | The canonical kanban/table stages in Teal, Huntr, Simplify — users think in these stages | LOW | Product adds "resume prepared" and "outreach sent" stages; table view is fine (Teal proves table works) |
| Notes + saved job detail per application | Teal/Huntr users rely on notes and captured JD text; JD text is also needed later for tailoring | LOW | Store the JD snapshot at save time — postings get taken down |
| Resume-vs-JD keyword gap visibility | Jobscan's core, replicated by Simplify and Teal; users expect to see *why* a resume matches or not | MEDIUM | Surfaces as "match reasons" on scored jobs and as the edit rationale in tailoring review |
| Resume upload + versions per user | Every tailoring tool manages multiple resume versions | LOW | DOCX upload with per-user private storage per PROJECT.md |
| Human review before any AI resume change lands | Teal's top complaint is wrong AI suggestions; unreviewed AI edits destroy trust | MEDIUM | Side-by-side diff review is the mitigation, and already a PROJECT.md integrity constraint |
| Auth with per-user data separation | Trivially expected of any multi-user web app | LOW | Invite-only, 2 users; Supabase RLS covers it |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **5–15 min discovery-to-notification latency** | Incumbent alerts are daily/weekly batches; even HiringCafe refreshes ~2x/day and gets criticized for it. Early application timing is the product's core value | HIGH | Requires frequent polling of ATS JSON endpoints + push pipeline; this is the make-or-break feature |
| **Browser web push (works with tab closed)** | Monitoring niche (Scoutify) treats push as premium; delivers the latency promise where email lags | MEDIUM | Service worker + VAPID; email as fallback is the safety net |
| **User-curated watchlist of 100+ specific company career sites** | Mainstream tools search what aggregators have; watching *your* target companies at the source beats every aggregator on speed and freshness | MEDIUM | ATS auto-detection (Greenhouse/Lever/Ashby JSON) is the pattern OpenJobRadar uses; HTML-scrape fallback is where complexity hides |
| **AI scoring against the user's own resume + preferences, with match reasons** | Jobscan scores resume-vs-one-JD on demand; nobody in the tracker category scores *every incoming job* against your profile automatically | MEDIUM | Cheap filters first keeps cost near zero; "why this matched" text on each card builds trust in the score |
| **DOCX-preserving tailoring → PDF** | Teal/Huntr/Simplify force their own resume builder templates; keeping the user's exact formatting while editing text is genuinely rare | HIGH | DOCX XML manipulation + faithful PDF conversion is the hard part; huge switching-cost advantage for users attached to their format |
| **Truthful-edits-only guarantee** | Directly answers the market's documented trust problem (Teal's wrong suggestions, keyword-stuffing culture around ATS scores) | LOW (policy) / MEDIUM (prompting + review UX) | Constrain AI to rephrase/reorder/emphasize existing facts; never invent skills or experience |
| **Stale-job removal / closed detection** | HiringCafe's most-praised trait: listings disappear when the role closes at the source | LOW–MEDIUM | Free byproduct of polling ATS endpoints — mark jobs missing from latest poll as closed |
| **Zero cost, no paywall, no upsell** | Every competitor gates core features (Huntr 40-job cap, Teal Pro, Jobscan scans) | LOW | Only viable because it's a 2-user tool; still worth stating as a design principle |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Auto-apply / one-click mass apply | "Apply to 100 jobs while I sleep" appeal; several tools sell this | LinkedIn/platform policy violations, garbage applications, account bans; PROJECT.md explicitly excludes it | Speed the *human* up: instant alerts + pre-tailored resume + direct apply link |
| Form autofill browser extension | Simplify's flagship; saves real time on Workday et al. | Requires building/maintaining an extension against 100+ constantly changing portals — enormous maintenance surface for 2 users | Deferred by design; revisit as companion extension post-v1 |
| Full resume builder with templates | Teal/Huntr bundle one; feels like a "complete" product | Commodity feature; users here already have polished DOCX resumes — a builder would *destroy* the DOCX-preservation differentiator | Tailor existing DOCX, never regenerate from templates |
| Gamified ATS match score as the goal ("get to 80!") | Jobscan trains users to chase a number | Encourages keyword stuffing; the number is a proxy, not truth; conflicts with truthful-edits principle | Show match *reasons* and keyword gaps as advisory context, not a score to max out |
| Kanban drag-drop board | Huntr's identity; visually satisfying | UI investment with little payoff for 2 users; Teal proves a table + stage dropdown works fine | Table view with stage column; revisit if it ever feels limiting |
| Contact CRM + outreach drafting | Teal's CRM, users ask for follow-up help | Deliberately deferred to v2 in PROJECT.md; contact discovery without paid APIs is its own project | v2 with heuristic email patterns + manual verification |
| Cover letter generator / email templates | Bundled by Teal, Simplify | Belongs to the outreach loop (v2); adds AI cost and review surface now | Defer with outreach drafting |
| LinkedIn logged-in scraping / Easy Apply automation | "That's where the jobs are" | Platform policy violation, account risk; explicitly out of scope | Aggregator API + ATS endpoints; LinkedIn official alerts as supplemental manual source |
| Mobile app / mobile push | "Alert me anywhere" | Native app for 2 users is absurd overhead; email already covers away-from-desk | Desktop web push + email backup |
| Interview prep / salary tools / analytics dashboards | Reviewers reward breadth; Teal bundles everything | Teal's documented failure mode is exactly this: feature sprawl → overwhelm | Stay narrow: discover → tailor → track |

## Feature Dependencies

```
Push/Email Alerts
    └──requires──> Scoring Pipeline (only alert on high scores)
                       └──requires──> Dedupe
                       │                  └──requires──> Monitoring (ATS polling + aggregator)
                       │                                     └──requires──> Watchlist + Preferences
                       └──requires──> AI Scoring
                                          └──requires──> Preferences + Base Resume Upload

Resume Tailoring (diff review → PDF)
    └──requires──> Base Resume Upload (DOCX)
    └──requires──> Job Detail w/ JD snapshot

Dashboard Match Feed ──requires──> Scoring Pipeline (scores + match reasons)

Tracker ──standalone── (manual add works alone)
    └──enhanced by──> Match Feed ("save to tracker" from a match)
    └──enhanced by──> Tailoring ("resume prepared" stage links the tailored PDF)

Stale-Job Detection ──enhances──> Match Feed + Tracker (byproduct of monitoring polls)

Auth + Data Separation ──required by──> everything above
```

### Dependency Notes

- **Alerts require the full pipeline:** an alert is only valuable if it fires on deduped, scored, relevant jobs — alerting on raw feed = spam, and users disable spammy alerts permanently. Pipeline quality gates alert usefulness.
- **AI scoring requires resume + preferences:** the differentiator is scoring against *the user's own resume*, so resume upload must land before or with scoring, even though tailoring comes later.
- **JD snapshot at save time requires monitoring/feed:** tailoring needs the job description text; postings vanish (stale-job insight), so capture JD when the job is first seen, not when tailoring starts.
- **Tracker is deliberately independent:** manual add must work so users can track jobs found outside the system (e.g., LinkedIn browsing) — Teal's core value is being the single collection point.
- **Autofill extension conflicts with v1 web-app shape:** it's a separate deliverable (extension) with its own maintenance burden; keep the boundary clean.

## MVP Definition

### Launch With (v1)

- [ ] Invite-only auth, 2 users, separated data — everything depends on it
- [ ] Preferences + watchlist management (titles, locations, keywords, 100+ company sites) — input to the whole pipeline
- [ ] Hybrid monitoring (Greenhouse/Lever/Ashby JSON + one aggregator) with dedupe — the discovery engine
- [ ] Cheap-filter → AI scoring with match reasons — makes the feed trustworthy and alerts non-spammy
- [ ] Web push + email alerts at 5–15 min latency — the core value; if this fails, nothing else matters
- [ ] Dashboard match feed with scores, reasons, posted-time, direct apply link, JD snapshot — daily surface
- [ ] DOCX upload, tailoring with side-by-side review, PDF download — the apply-fast half of the loop
- [ ] Manual tracker with stages (saved → resume prepared → applied → outreach sent → interview → rejected → offer) — closes the loop, low cost

### Add After Validation (v1.x)

- [ ] Stale/closed-job marking — trigger: first time a user applies to an already-closed role; nearly free from polling data
- [ ] Alert tuning (score threshold per user, quiet hours, digest fallback) — trigger: first complaint of too many/too few alerts
- [ ] Keyword-gap panel on job detail (Jobscan-style categorized gaps, advisory only) — trigger: users asking "why did this score low?"
- [ ] Save-to-tracker from arbitrary URL (paste a LinkedIn link, parse basics) — trigger: users tracking many jobs found outside the feed

### Future Consideration (v2+)

- [ ] Outreach drafting + heuristic contact discovery — deferred by design (PROJECT.md)
- [ ] Companion autofill extension — separate deliverable, high maintenance
- [ ] Cover letter / follow-up email generation — belongs with the outreach loop
- [ ] Interview-stage helpers, analytics — avoid Teal-style sprawl until core loop is validated

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Monitoring + dedupe pipeline | HIGH | HIGH | P1 |
| Push + email alerts (5–15 min) | HIGH | MEDIUM | P1 |
| AI scoring + match reasons | HIGH | MEDIUM | P1 |
| Preferences + watchlist mgmt | HIGH | LOW | P1 |
| Dashboard match feed | HIGH | MEDIUM | P1 |
| DOCX tailoring + review + PDF | HIGH | HIGH | P1 |
| Manual tracker (table + stages) | MEDIUM | LOW | P1 |
| Auth + data separation | HIGH | LOW | P1 |
| Stale-job detection | MEDIUM | LOW | P2 |
| Alert tuning controls | MEDIUM | LOW | P2 |
| Keyword-gap advisory panel | MEDIUM | MEDIUM | P2 |
| Save-from-URL to tracker | MEDIUM | MEDIUM | P2 |
| Outreach drafting | HIGH | HIGH | P3 (v2) |
| Autofill extension | MEDIUM | HIGH | P3 |
| Kanban board UI | LOW | MEDIUM | P3 |

## Competitor Feature Analysis

| Feature | Teal | Simplify | Huntr | Jobscan | Monitoring niche (Scoutify/OpenJobRadar) | Our Approach |
|---------|------|----------|-------|---------|------------------------------------------|--------------|
| Job discovery | Search existing boards | Matching feed from aggregated jobs | None (capture-only) | None | Watch career pages at source | Watchlist ATS polling + aggregator, scored against user profile |
| Alert latency | N/A | Batch | N/A | N/A | Minutes–24h (their whole pitch) | 5–15 min push + email — compete with the niche, beat the mainstream |
| Job capture | Extension, 50+ boards | Auto-add on apply | Extension one-click | N/A | N/A | Auto from pipeline + manual tracker add (extension deferred) |
| Resume tailoring | Builder-based, AI suggestions (often wrong per reviews) | AI builder, keyword injection | Builder + JD tailoring | Advisory scan report only | N/A | Edit user's own DOCX, truthful edits, mandatory diff review, PDF out |
| Match scoring | Skill match (unreliable per reviews) | Missing-keyword overlay | Basic | Match rate vs 30+ params | Keyword filters only | AI score vs resume + preferences with plain-language reasons, post cheap-filter |
| Tracker | Table + pipeline, CRM, checklists | Auto-populated tracker | Kanban drag-drop | None | None | Simple table with 7 stages incl. "resume prepared" / "outreach sent" |
| Pricing model | Freemium, Pro upsell | Free + Simplify+ | Free to 40 jobs, then paid | Freemium, scan limits | Paid subscriptions | Free by construction (2 users, free tiers) |

## Sources

- Teal official ([tealhq.com/tools/job-tracker](https://www.tealhq.com/tools/job-tracker), [how-it-works](https://www.tealhq.com/how-it-works)) + independent reviews ([ResumeHog](https://resumehog.com/blog/posts/teal-hq-review-2026-is-this-job-search-tool-worth-it.html), [Rezi](https://www.rezi.ai/posts/teal-review), [LoopCV](https://blog.loopcv.pro/teal-hq-review/)) — MEDIUM (cross-verified)
- Simplify official ([simplify.jobs](https://simplify.jobs/), [copilot](https://simplify.jobs/copilot), [job-application-tracker](https://simplify.jobs/job-application-tracker), [help center](https://help.simplify.jobs/articles/8197013-the-complete-guide-to-simplify)) + [HirePilot review](https://hirepilot.co/simplify-extension-review-does-it-actually-work/) — MEDIUM (cross-verified)
- Huntr official ([huntr.co](https://huntr.co/), [job-tracker](https://huntr.co/product/job-tracker), [autofill](https://huntr.co/product/job-application-autofill)) + reviews ([ResumeHog](https://resumehog.com/blog/posts/huntr-review-2026-is-this-job-tracker-worth-it.html), [LoopCV](https://www.loopcv.pro/directory/huntr/)) — MEDIUM (cross-verified)
- Jobscan official ([jobscan.co](https://www.jobscan.co/), [resume-scanner](https://www.jobscan.co/resume-scanner)) + [ATS Resume AI review](https://www.atsresumeai.com/compare/jobscan-review) — MEDIUM (cross-verified)
- Career-page monitoring niche: [OpenJobRadar](https://openjobradar.com/), [Scoutify real-time alerts](https://scoutify.com/blog/best-ways-real-time-job-alerts), [Jobstrack](https://jobstrack.io/blog/how-to-monitor-company-career-pages), [Greenhouse MyGreenhouse alerts](https://support.greenhouse.io/hc/en-us/articles/38047613116443-MyGreenhouse-job-alerts) — MEDIUM for the latency landscape; individual tool claims LOW (vendor self-reported)
- HiringCafe freshness/dedupe insight: [hiring.cafe](https://hiring.cafe/), [Scoutify review](https://scoutify.com/blog/hiringcafe-review/), [Jobright review](https://jobright.ai/blog/hiringcafe-review-2026-features-pros-cons-and-alternatives/) — MEDIUM (cross-verified)
- User-sentiment comparisons ([Optim Careers](https://optimcareers.com/expert-articles/job-application-tracker), [Prentus](https://prentus.com/blog/we-found-the-5-best-job-tracker-tools-on-the-market)) — LOW (secondary roundups, no direct Reddit threads retrieved)

---
*Feature research for: job-discovery + AI resume-tailoring copilot*
*Researched: 2026-07-15*

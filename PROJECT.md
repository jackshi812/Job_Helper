# Job Application Copilot

## Goal

An invite-only web app for two users that discovers relevant jobs within 5–15 minutes, speeds up applications, and assists with approved outreach.

## Core workflow

1. Each user configures job preferences and manages a watchlist of 100+ company career sites.
2. The copilot also discovers relevant jobs from companies outside the watchlist.
3. It deduplicates and scores postings, then surfaces strong matches in the dashboard feed.
4. The user opens a job, selects one of several base resumes, reviews tailored keyword edits, and downloads a PDF.
5. The user opens the employer's application page and submits manually; form autofill can be added later.
6. On request, the copilot finds likely contacts and drafts both email and LinkedIn outreach. Nothing is sent without approval; LinkedIn messages are sent manually.
7. Users manually track stages: saved, resume prepared, applied, outreach sent, interview, rejected, or offer.

## Data and safety

- Separate accounts, preferences, resumes, watchlists, applications, and drafts for each user.
- Store resumes in encrypted private cloud storage with user-controlled deletion.
- Tailoring must remain truthful and require user review.
- Do not scrape logged-in LinkedIn pages, automate Easy Apply, or automatically send LinkedIn messages.
- Use LinkedIn alerts only as a supplemental source; official alerts are daily/weekly and LinkedIn has no open job-search API.

## Pilot architecture

- **Frontend:** Cloudflare Pages
- **Backend:** Supabase Free for authentication, database, resume storage, scheduled monitoring, and functions
- **AI:** External API, called only after inexpensive filtering
- **Match delivery:** Dashboard feed only; no email or push notifications
- **Compute:** Cloud-hosted; no local GPU required

This should fit free hosting tiers for two users. Likely variable costs are AI calls and contact discovery or verification. Google Colab is unsuitable for persistent hosting; Azure for Students is a viable alternative but its credit is limited.

## Main risks

- Reliable monitoring across heterogeneous career sites
- Incomplete coverage outside the company watchlist
- Scoring quality versus missed opportunities
- Changing application forms and ATS platforms
- Contact accuracy, outreach quality, and email deliverability
- Free-tier limits and third-party API costs

## References

- [LinkedIn job alerts](https://www.linkedin.com/help/linkedin/answer/a511279/job-alerts-on-linkedin)
- [LinkedIn automated activity policy](https://www.linkedin.com/help/linkedin/answer/a1340567)
- [Supabase pricing](https://supabase.com/pricing)
- [Supabase scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

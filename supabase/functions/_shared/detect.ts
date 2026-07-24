import { resolvePaylocityIdentity } from './provider-identities.ts'
import { resolveWorkdayIdentity } from './workday-identities.ts'

export type DetectResult =
  | {
      ats: 'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters' | 'recruitee' | 'paylocity'
      slug: string
      region?: 'eu'
    }
  | {
      // Values are still validated by the frozen identity registry (allowlist +
      // anchored host/region regexes), never accepted as free strings. hostForm
      // disambiguates the two real Workday URL shapes (Form A myworkdayjobs vs
      // Form B myworkdaysite) so the pollable origin is never inferred from region.
      ats: 'workday'
      slug: string
      region: string
      site: string
      hostForm: 'jobs' | 'site'
    }
  | { ats: 'unsupported' }

export const UNSUPPORTED_URL_MESSAGE =
  "This URL isn't a supported job board. Job Copilot works with Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee, and allowlisted Workday boards. Use the exact public careers-board URL — usually where the careers page's Apply buttons point."

const supportedHosts = {
  // Exact hosts only. Never match by suffix/wildcard/endsWith against
  // greenhouse.io — that would admit evil-greenhouse.io and
  // greenhouse.io.attacker.example. This Set is the SSRF gate.
  greenhouseBoard: new Set([
    'boards.greenhouse.io',
    'job-boards.greenhouse.io',
    'job-boards.eu.greenhouse.io',
    'boards.eu.greenhouse.io',
  ]),
  greenhouseEmbed: 'greenhouse.io',
  lever: 'jobs.lever.co',
  leverEu: 'jobs.eu.lever.co',
  ashby: 'jobs.ashbyhq.com',
  smartrecruiters: 'jobs.smartrecruiters.com',
  recruiteeSuffix: '.recruitee.com',
  paylocity: 'recruiting.paylocity.com',
}

// Anchored, exact-host Workday matchers. NEVER endsWith/suffix — the `^`/`$`
// anchors plus a literal `.myworkday{jobs,site}.com` are the SSRF gate:
//   Form A: {tenant}.{region}.myworkdayjobs.com   (Capital One)
//   Form B: {region}.myworkdaysite.com            (Fidelity)
// so a lookalike like wd1.myworkdaysite.com.evil.example can never match.
const workdayFormAHost = /^([a-z0-9-]+)\.(wd\d{1,3})\.myworkdayjobs\.com$/
const workdayFormBHost = /^(wd\d{1,3})\.myworkdaysite\.com$/

const strictSlug = /^[A-Za-z0-9_-]+$/
const unsupported: DetectResult = { ats: 'unsupported' }

function normalizedHost(url: URL) {
  return url.hostname.toLowerCase().replace(/^www\./, '')
}

function singlePathSegment(url: URL) {
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length !== 1) return null

  try {
    const segment = decodeURIComponent(segments[0])
    return segment && !segment.includes('/') ? segment : null
  } catch {
    return null
  }
}

export function detectAts(href: string): DetectResult {
  try {
    const url = new URL(href)
    const rawHost = url.hostname.toLowerCase()
    const host = normalizedHost(url)

    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || url.port
      || url.hash
    ) return unsupported

    // Workday Form A: {tenant}.{region}.myworkdayjobs.com/{site}
    const formA = workdayFormAHost.exec(rawHost)
    if (formA) {
      if (url.search) return unsupported
      const [, tenant, region] = formA
      const site = singlePathSegment(url)
      if (!site || !strictSlug.test(site) || !strictSlug.test(tenant)) return unsupported
      // Fail-closed: only tuples admitted by the frozen registry become pollable.
      const identity = resolveWorkdayIdentity(tenant, region, site, 'jobs')
      return identity
        ? {
            ats: 'workday',
            slug: identity.tenant,
            region: identity.region,
            site: identity.site,
            hostForm: 'jobs',
          }
        : unsupported
    }

    // Workday Form B: {region}.myworkdaysite.com/{locale}/recruiting/{tenant}/{site}
    const formB = workdayFormBHost.exec(rawHost)
    if (formB) {
      if (url.search) return unsupported
      const [, region] = formB
      const segments = url.pathname.split('/').filter(Boolean)
      if (segments.length !== 4 || segments[1] !== 'recruiting') return unsupported
      const tenant = segments[2]
      const site = segments[3]
      if (!strictSlug.test(tenant) || !strictSlug.test(site)) return unsupported
      // Fail-closed: only tuples admitted by the frozen registry become pollable.
      const identity = resolveWorkdayIdentity(tenant, region, site, 'site')
      return identity
        ? {
            ats: 'workday',
            slug: identity.tenant,
            region: identity.region,
            site: identity.site,
            hostForm: 'site',
          }
        : unsupported
    }

    if (rawHost === supportedHosts.paylocity) {
      if (url.search) return unsupported

      const segments = url.pathname.split('/').filter(Boolean)
      if (
        segments.length !== 5
        || segments[0] !== 'recruiting'
        || segments[1] !== 'jobs'
        || segments[2] !== 'All'
      ) return unsupported

      const identity = resolvePaylocityIdentity(segments[3])
      return identity && segments[4] === identity.reviewedSlug
        ? { ats: 'paylocity', slug: identity.boardUuid }
        : unsupported
    }

    // Deliberately no `region` here, unlike the Lever branch below. Greenhouse's
    // EU hosts are display-only: the Job Board API is unified on
    // boards-api.greenhouse.io (boards-api.eu.greenhouse.io does not resolve), so
    // one board is one identity. Adding a region would make deterministicSourceKey
    // emit greenhouse:eu:<slug> and greenhouse:global:<slug> for the same board,
    // splitting it into two sources and ingesting every job twice. Lever, by
    // contrast, has a genuinely separate regional API host, so it does carry one.
    if (supportedHosts.greenhouseBoard.has(host)) {
      const slug = singlePathSegment(url)
      return slug && strictSlug.test(slug) ? { ats: 'greenhouse', slug } : unsupported
    }

    if (
      host === supportedHosts.greenhouseEmbed
      && url.pathname === '/embed/job_board'
      && [...url.searchParams.keys()].length === 1
      && url.searchParams.has('for')
    ) {
      const slug = url.searchParams.get('for')
      return slug && strictSlug.test(slug) ? { ats: 'greenhouse', slug } : unsupported
    }

    if (host === supportedHosts.lever || host === supportedHosts.leverEu) {
      const slug = singlePathSegment(url)
      if (!slug || !strictSlug.test(slug)) return unsupported
      return host === supportedHosts.leverEu
        ? { ats: 'lever', slug, region: 'eu' }
        : { ats: 'lever', slug }
    }

    if (host === supportedHosts.ashby) {
      const slug = singlePathSegment(url)
      return slug && strictSlug.test(slug) && !url.search
        ? { ats: 'ashby', slug }
        : unsupported
    }

    if (host === supportedHosts.smartrecruiters) {
      const slug = singlePathSegment(url)
      return slug && strictSlug.test(slug) && !url.search
        ? { ats: 'smartrecruiters', slug }
        : unsupported
    }

    if (host.endsWith(supportedHosts.recruiteeSuffix)) {
      const slug = host.slice(0, -supportedHosts.recruiteeSuffix.length)
      return strictSlug.test(slug)
        && (url.pathname === '/' || url.pathname === '')
        && !url.search
        ? { ats: 'recruitee', slug }
        : unsupported
    }

    return unsupported
  } catch {
    return unsupported
  }
}

export function buildEndpoint(detected: DetectResult): string {
  if (detected.ats === 'unsupported') throw new Error(UNSUPPORTED_URL_MESSAGE)

  const slug = encodeURIComponent(detected.slug)
  if (detected.ats === 'greenhouse') {
    return `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`
  }
  if (detected.ats === 'lever') {
    const host = detected.region === 'eu' ? 'api.eu.lever.co' : 'api.lever.co'
    return `https://${host}/v0/postings/${slug}?mode=json`
  }
  if (detected.ats === 'ashby') {
    return `https://api.ashbyhq.com/posting-api/job-board/${slug}`
  }
  if (detected.ats === 'smartrecruiters') {
    return `https://api.smartrecruiters.com/v1/companies/${slug}/postings`
  }
  if (detected.ats === 'paylocity') {
    const identity = resolvePaylocityIdentity(detected.slug)
    if (!identity) throw new Error(UNSUPPORTED_URL_MESSAGE)
    return `https://recruiting.paylocity.com/recruiting/v2/api/feed/jobs/${identity.feedKey}`
  }
  if (detected.ats === 'workday') {
    const identity = resolveWorkdayIdentity(
      detected.slug,
      detected.region,
      detected.site,
      detected.hostForm,
    )
    if (!identity) throw new Error(UNSUPPORTED_URL_MESSAGE)
    return `${identity.cxsRoot}/jobs`
  }
  return `https://${detected.slug.toLowerCase()}.recruitee.com/api/offers/`
}

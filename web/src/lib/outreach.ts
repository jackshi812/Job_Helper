export type OutreachChannel = 'linkedin' | 'email'

export type OutreachStorage = Pick<Storage, 'getItem' | 'setItem'>

export interface OutreachPreferences {
  linkedInTemplate: string
  emailSubjectTemplate: string
  emailBodyTemplate: string
  companyDomains: Record<string, string>
}

export interface OutreachTemplateVariables {
  firstName?: string
  company?: string
  position?: string
}

export interface OutreachNameSuggestion {
  firstName: string
  lastName: string
}

export interface OutreachDomainSuggestion {
  domain: string
  source: 'apply_url' | 'company_name'
}

export interface EmailPossibilityInput {
  firstName: string
  lastName: string
  domain: string
}

export interface OutlookComposeInput {
  recipient: string
  subject: string
  body: string
}

export const DEFAULT_LINKEDIN_TEMPLATE =
  'Hi {{firstName}},\n\nI am interested in the {{position}} opportunity at {{company}} and would appreciate the chance to learn about your experience there. Would you be open to connecting?'

export const DEFAULT_EMAIL_SUBJECT_TEMPLATE =
  'Question about the {{position}} opportunity at {{company}}'

export const DEFAULT_EMAIL_BODY_TEMPLATE =
  'Hi {{firstName}},\n\nI am interested in the {{position}} opportunity at {{company}} and would appreciate the chance to learn about your experience there. If you have a few minutes, I would be grateful to connect.\n\nThank you,'

const STORAGE_PREFIX = 'job-copilot:outreach:'
const STORAGE_VERSION = ':v1'
const UNSAFE_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const DOMAIN_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
const DOMAIN_PATTERN = new RegExp(`^(?:${DOMAIN_LABEL}\\.)+${DOMAIN_LABEL}$`, 'u')
const COMPANY_SUFFIXES = new Set([
  'co',
  'company',
  'corp',
  'corporation',
  'group',
  'holdings',
  'inc',
  'international',
  'limited',
  'llc',
  'lp',
  'ltd',
  'plc',
  'the',
])
const RECRUITING_HOST_PREFIXES = new Set([
  'career',
  'careers',
  'hire',
  'higher',
  'hiring',
  'job',
  'jobs',
  'recruiting',
  'recruitment',
  'work',
  'www',
])
const SHARED_RECRUITING_HOSTS = [
  'adzuna.com',
  'ashbyhq.com',
  'bamboohr.com',
  'dayforcehcm.com',
  'eightfold.ai',
  'glassdoor.com',
  'greenhouse.io',
  'icims.com',
  'indeed.com',
  'jobvite.com',
  'lever.co',
  'linkedin.com',
  'myworkdayjobs.com',
  'myworkdaysite.com',
  'oraclecloud.com',
  'paycomonline.net',
  'paylocity.com',
  'phenompeople.com',
  'smartrecruiters.com',
  'successfactors.com',
  'ukg.com',
  'ultipro.com',
  'workable.com',
] as const

function browserStorage(): OutreachStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asciiWords(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
}

function emailNamePart(value: string): string {
  return asciiWords(value).replace(/\s+/gu, '')
}

function titleCaseAscii(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}

function sanitizedCompanyDomains(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}

  const domains: Record<string, string> = {}
  for (const [rawCompany, rawDomain] of Object.entries(value)) {
    if (
      typeof rawDomain !== 'string'
      || UNSAFE_RECORD_KEYS.has(rawCompany.trim().toLocaleLowerCase('en-US'))
    ) {
      continue
    }
    const company = normalizeOutreachCompanyKey(rawCompany)
    const domain = normalizeCompanyDomain(rawDomain)
    if (!company || !domain || UNSAFE_RECORD_KEYS.has(company)) continue
    domains[company] = domain
  }
  return domains
}

export function defaultOutreachPreferences(): OutreachPreferences {
  return {
    linkedInTemplate: DEFAULT_LINKEDIN_TEMPLATE,
    emailSubjectTemplate: DEFAULT_EMAIL_SUBJECT_TEMPLATE,
    emailBodyTemplate: DEFAULT_EMAIL_BODY_TEMPLATE,
    companyDomains: {},
  }
}

export function outreachPreferencesStorageKey(userId: string): string | null {
  const namespace = userId.trim()
  return namespace
    ? `${STORAGE_PREFIX}${encodeURIComponent(namespace)}${STORAGE_VERSION}`
    : null
}

export function loadOutreachPreferences(
  userId: string,
  storage: OutreachStorage | null = browserStorage(),
): OutreachPreferences {
  const key = outreachPreferencesStorageKey(userId)
  if (!key || !storage) return defaultOutreachPreferences()

  try {
    const serialized = storage.getItem(key)
    if (!serialized) return defaultOutreachPreferences()
    const parsed: unknown = JSON.parse(serialized)
    if (
      !isRecord(parsed)
      || typeof parsed.linkedInTemplate !== 'string'
      || typeof parsed.emailSubjectTemplate !== 'string'
      || typeof parsed.emailBodyTemplate !== 'string'
      || !isRecord(parsed.companyDomains)
    ) {
      return defaultOutreachPreferences()
    }
    return {
      linkedInTemplate: parsed.linkedInTemplate,
      emailSubjectTemplate: parsed.emailSubjectTemplate,
      emailBodyTemplate: parsed.emailBodyTemplate,
      companyDomains: sanitizedCompanyDomains(parsed.companyDomains),
    }
  } catch {
    return defaultOutreachPreferences()
  }
}

export function saveOutreachPreferences(
  userId: string,
  preferences: OutreachPreferences,
  storage: OutreachStorage | null = browserStorage(),
): boolean {
  const key = outreachPreferencesStorageKey(userId)
  if (!key || !storage) return false

  const raw = preferences as unknown
  const value = isRecord(raw) ? raw : {}
  const defaults = defaultOutreachPreferences()
  const sanitized: OutreachPreferences = {
    linkedInTemplate: typeof value.linkedInTemplate === 'string'
      ? value.linkedInTemplate
      : defaults.linkedInTemplate,
    emailSubjectTemplate: typeof value.emailSubjectTemplate === 'string'
      ? value.emailSubjectTemplate
      : defaults.emailSubjectTemplate,
    emailBodyTemplate: typeof value.emailBodyTemplate === 'string'
      ? value.emailBodyTemplate
      : defaults.emailBodyTemplate,
    companyDomains: sanitizedCompanyDomains(value.companyDomains),
  }

  try {
    storage.setItem(key, JSON.stringify(sanitized))
    return true
  } catch {
    return false
  }
}

export function renderOutreachTemplate(
  template: string,
  variables: OutreachTemplateVariables,
): string {
  return template.replace(/\{\{(firstName|company|position)\}\}/gu, (_, token: string) => {
    if (token === 'firstName') return variables.firstName ?? ''
    if (token === 'company') return variables.company ?? ''
    return variables.position ?? ''
  })
}

export function suggestNameFromLinkedInUrl(
  value: string,
): OutreachNameSuggestion | null {
  try {
    const parsed = new URL(value)
    if (
      parsed.protocol !== 'https:'
      || (parsed.hostname !== 'linkedin.com' && parsed.hostname !== 'www.linkedin.com')
      || parsed.username
      || parsed.password
    ) {
      return null
    }
    const match = /^\/in\/([^/]+)\/?$/u.exec(parsed.pathname)
    if (!match) return null
    const slug = decodeURIComponent(match[1])
    const parts = slug.split('-')
    if (parts.length > 1 && /\d/u.test(parts[parts.length - 1])) parts.pop()
    if (
      parts.length < 2
      || parts.length > 5
      || parts.some((part) => !/^[A-Za-z]+$/u.test(part))
    ) return null
    const suffixes = new Set(['ii', 'iii', 'iv', 'jr', 'sr'])
    const lastIndex = suffixes.has(parts[parts.length - 1].toLowerCase())
      ? parts.length - 2
      : parts.length - 1
    return {
      firstName: titleCaseAscii(parts[0]),
      lastName: titleCaseAscii(parts[lastIndex]),
    }
  } catch {
    return null
  }
}

export function normalizeOutreachCompanyKey(value: string): string {
  return asciiWords(value)
}

export function normalizeCompanyDomain(value: string): string | null {
  const normalized = value.trim().replace(/^@/u, '').toLocaleLowerCase('en-US')
  if (
    !normalized
    || normalized.length > 253
    || !DOMAIN_PATTERN.test(normalized)
  ) {
    return null
  }
  return normalized
}

function companyDomainCandidate(company: string): string | null {
  const words = asciiWords(company)
    .split(' ')
    .filter((word) => word && !COMPANY_SUFFIXES.has(word))
  const label = words.join('')
  return label.length >= 2 ? normalizeCompanyDomain(`${label}.com`) : null
}

function hostBelongsToCompany(hostname: string, company: string): boolean {
  const companyWords = asciiWords(company)
    .split(' ')
    .filter((word) => word && !COMPANY_SUFFIXES.has(word))
  const joined = companyWords.join('')
  const acronym = companyWords.map((word) => word.charAt(0)).join('')
  const firstLabel = hostname.split('.')[0].replace(/[^a-z0-9]/gu, '')
  return Boolean(
    firstLabel
    && (
      firstLabel === joined
      || (acronym.length >= 2 && firstLabel === acronym)
    )
  )
}

function employerDomainFromApplyUrl(
  company: string,
  applyUrl: string | null,
): string | null {
  if (!applyUrl) return null
  try {
    const parsed = new URL(applyUrl)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
    const hostname = parsed.hostname.toLocaleLowerCase('en-US').replace(/\.$/u, '')
    if (SHARED_RECRUITING_HOSTS.some((shared) => (
      hostname === shared || hostname.endsWith(`.${shared}`)
    ))) return null

    const labels = hostname.split('.')
    while (labels.length > 2 && RECRUITING_HOST_PREFIXES.has(labels[0])) labels.shift()
    const candidate = labels.join('.')
    if (
      !candidate
      || /(?:career|careers|hire|hiring|job|jobs|recruit)/u.test(labels[0])
      || !hostBelongsToCompany(candidate, company)
    ) return null
    return normalizeCompanyDomain(candidate)
  } catch {
    return null
  }
}

export function suggestCompanyDomain(
  company: string,
  applyUrl: string | null,
): OutreachDomainSuggestion | null {
  const fromApplyUrl = employerDomainFromApplyUrl(company, applyUrl)
  if (fromApplyUrl) return { domain: fromApplyUrl, source: 'apply_url' }
  const fromCompany = companyDomainCandidate(company)
  return fromCompany ? { domain: fromCompany, source: 'company_name' } : null
}

export function generateEmailPossibilities(
  input: EmailPossibilityInput,
): string[] {
  const first = emailNamePart(input.firstName)
  const last = emailNamePart(input.lastName)
  const domain = normalizeCompanyDomain(input.domain)
  if (!first || !domain) return []
  if (!last) {
    const address = `${first}@${domain}`
    return first.length <= 64 && address.length <= 254 ? [address] : []
  }

  const initial = first.charAt(0)
  const localParts = new Set([
    `${first}.${last}`,
    `${first}${last}`,
    `${initial}${last}`,
    `${initial}.${last}`,
    `${first}_${last}`,
    `${last}.${first}`,
    first,
  ])
  return [...localParts].flatMap((localPart) => {
    const address = `${localPart}@${domain}`
    return localPart.length <= 64 && address.length <= 254 ? [address] : []
  })
}

export function outlookComposeUrl(input: OutlookComposeInput): string | null {
  if (!input.recipient.trim()) return null

  const url = new URL('https://outlook.office.com/mail/deeplink/compose')
  url.searchParams.set('to', input.recipient)
  url.searchParams.set('subject', input.subject)
  url.searchParams.set('body', input.body)
  return url.toString()
}

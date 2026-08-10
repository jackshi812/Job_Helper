import { describe, expect, it } from 'vitest'
import outreachSource from './outreach.ts?raw'
import {
  DEFAULT_EMAIL_BODY_TEMPLATE,
  DEFAULT_EMAIL_SUBJECT_TEMPLATE,
  DEFAULT_LINKEDIN_TEMPLATE,
  defaultOutreachPreferences,
  generateEmailPossibilities,
  outlookComposeUrl,
  loadOutreachPreferences,
  normalizeCompanyDomain,
  normalizeOutreachCompanyKey,
  outreachPreferencesStorageKey,
  renderOutreachTemplate,
  saveOutreachPreferences,
  suggestCompanyDomain,
  suggestNameFromLinkedInUrl,
  type OutreachPreferences,
  type OutreachStorage,
} from './outreach'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const writes: Array<{ key: string; value: string }> = []
  const storage: OutreachStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
      writes.push({ key, value })
    },
  }
  return { storage, values, writes }
}

describe('outreach template rendering', () => {
  it('replaces every supported token, defaults missing values, and preserves unknown tokens', () => {
    expect(renderOutreachTemplate(
      '{{firstName}} / {{company}} / {{position}} / {{firstName}} / {{unknown}}',
      { firstName: 'Sam', company: 'Acme', position: undefined },
    )).toBe('Sam / Acme /  / Sam / {{unknown}}')
  })
})

describe('LinkedIn URL name suggestions', () => {
  it.each([
    ['https://linkedin.com/in/ada-lovelace', { firstName: 'Ada', lastName: 'Lovelace' }],
    ['https://www.linkedin.com/in/mary-jane-watson', { firstName: 'Mary', lastName: 'Watson' }],
    ['https://linkedin.com/in/jean-luc-picard-sr', { firstName: 'Jean', lastName: 'Picard' }],
    ['https://www.linkedin.com/in/ada-lovelace-18b708143/?trk=people-guest#about', { firstName: 'Ada', lastName: 'Lovelace' }],
  ])('suggests editable names from an exact safe profile URL: %s', (url, expected) => {
    expect(suggestNameFromLinkedInUrl(url)).toEqual(expected)
  })

  it.each([
    'http://linkedin.com/in/ada-lovelace',
    'https://user:pass@linkedin.com/in/ada-lovelace',
    'https://linkedin.example/in/ada-lovelace',
    'https://linkedin.com/company/ada-lovelace',
    'https://linkedin.com/in/ada-lovelace/posts',
    'https://linkedin.com/in/single',
    'https://linkedin.com/in/ada_lovelace',
    'not a url',
  ])('returns no suggestion for unsafe or ambiguous input: %s', (url) => {
    expect(suggestNameFromLinkedInUrl(url)).toBeNull()
  })
})

describe('company and email normalization', () => {
  it('normalizes company keys and structurally valid DNS-style domains', () => {
    expect(normalizeOutreachCompanyKey('  Acmé,  Inc. ')).toBe('acme inc')
    expect(normalizeCompanyDomain(' @Careers.Example.COM ')).toBe('careers.example.com')
  })

  it.each([
    '',
    'example',
    'https://example.com',
    'example.com/jobs',
    'user@example.com',
    'example.com:443',
    '-example.com',
    'example-.com',
    'exa_mple.com',
    'example..com',
  ])('rejects invalid domains: %s', (domain) => {
    expect(normalizeCompanyDomain(domain)).toBeNull()
  })

  it('suggests a matching employer host before a company-name fallback', () => {
    expect(suggestCompanyDomain(
      'Goldman Sachs',
      'https://higher.gs.com/roles/123',
    )).toEqual({ domain: 'gs.com', source: 'apply_url' })
    expect(suggestCompanyDomain(
      'Salesforce',
      'https://careers.salesforce.com/en/jobs/123',
    )).toEqual({ domain: 'salesforce.com', source: 'apply_url' })
    expect(suggestCompanyDomain(
      'Capital One',
      'https://capitalone.wd12.myworkdayjobs.com/Capital_One/job/123',
    )).toEqual({ domain: 'capitalone.com', source: 'company_name' })
  })

  it('rejects unrelated and recruiting-branded hosts while retaining an immediate fallback', () => {
    expect(suggestCompanyDomain(
      'Acme, Inc.',
      'https://example.com/jobs/1',
    )).toEqual({ domain: 'acme.com', source: 'company_name' })
    expect(suggestCompanyDomain(
      'Capital One',
      'https://www.capitalonecareers.com/search-jobs',
    )).toEqual({ domain: 'capitalone.com', source: 'company_name' })
    expect(suggestCompanyDomain('A', null)).toBeNull()
  })

  it('emits the seven locked possibilities in stable normalized order', () => {
    expect(generateEmailPossibilities({
      firstName: ' Élodie ',
      lastName: " O'Neill ",
      domain: '@Example.COM',
    })).toEqual([
      'elodie.oneill@example.com',
      'elodieoneill@example.com',
      'eoneill@example.com',
      'e.oneill@example.com',
      'elodie_oneill@example.com',
      'oneill.elodie@example.com',
      'elodie@example.com',
    ])
  })

  it('supports first-only input and removes duplicates without reordering', () => {
    expect(generateEmailPossibilities({
      firstName: 'Ada',
      lastName: '',
      domain: 'example.com',
    })).toEqual(['ada@example.com'])
    expect(generateEmailPossibilities({
      firstName: 'A',
      lastName: 'A',
      domain: 'example.com',
    })).toEqual([
      'a.a@example.com',
      'aa@example.com',
      'a_a@example.com',
      'a@example.com',
    ])
  })

  it('returns no invalid candidate when required names or domain are absent', () => {
    expect(generateEmailPossibilities({
      firstName: '',
      lastName: 'Lovelace',
      domain: 'example.com',
    })).toEqual([])
    expect(generateEmailPossibilities({
      firstName: 'Ada',
      lastName: 'Lovelace',
      domain: 'not-a-domain',
    })).toEqual([])
  })

  it('enforces the 64-character local-part and 254-character address limits', () => {
    const localPart64 = 'a'.repeat(64)
    const address254Domain = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`
    const address255Domain = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}`

    expect(generateEmailPossibilities({
      firstName: localPart64,
      lastName: '',
      domain: 'example.com',
    })).toEqual([`${localPart64}@example.com`])
    expect(generateEmailPossibilities({
      firstName: 'a'.repeat(65),
      lastName: '',
      domain: 'example.com',
    })).toEqual([])
    expect(generateEmailPossibilities({
      firstName: localPart64,
      lastName: '',
      domain: address254Domain,
    })).toEqual([`${localPart64}@${address254Domain}`])
    expect(generateEmailPossibilities({
      firstName: localPart64,
      lastName: '',
      domain: address255Domain,
    })).toEqual([])
  })
})

describe('Outlook compose handoff', () => {
  it('builds one fixed HTTPS compose URL with exact decoded fields', () => {
    const input = {
      recipient: 'ada+jobs@example.com',
      subject: 'Hello & welcome + 你好',
      body: 'Line one\nLine two & more + café',
    }
    const href = outlookComposeUrl(input)
    expect(href).not.toBeNull()
    const parsed = new URL(href!)

    expect(parsed.protocol).toBe('https:')
    expect(parsed.hostname).toBe('outlook.office.com')
    expect(parsed.pathname).toBe('/mail/deeplink/compose')
    expect([...parsed.searchParams.keys()]).toEqual(['to', 'subject', 'body'])
    expect(parsed.searchParams.getAll('to')).toEqual([input.recipient])
    expect(parsed.searchParams.getAll('subject')).toEqual([input.subject])
    expect(parsed.searchParams.getAll('body')).toEqual([input.body])
    expect(parsed.searchParams.has('view')).toBe(false)
    expect(parsed.searchParams.has('fs')).toBe(false)
    expect(parsed.searchParams.has('su')).toBe(false)
  })

  it('does not create a handoff without an explicitly selected recipient', () => {
    expect(outlookComposeUrl({ recipient: '  ', subject: 'Hi', body: 'Hello' })).toBeNull()
  })
})

describe('outreach preference storage', () => {
  it('uses distinct versioned keys and refuses an empty namespace', () => {
    expect(outreachPreferencesStorageKey('user-a')).toBe(
      'job-copilot:outreach:user-a:v1',
    )
    expect(outreachPreferencesStorageKey('user a/+')).toBe(
      'job-copilot:outreach:user%20a%2F%2B:v1',
    )
    expect(outreachPreferencesStorageKey('user-a')).not.toBe(
      outreachPreferencesStorageKey('user-b'),
    )
    expect(outreachPreferencesStorageKey('  ')).toBeNull()
  })

  it('round-trips only the narrow sanitized preference schema per user', () => {
    const { storage, values } = memoryStorage()
    const unsafe = {
      linkedInTemplate: 'LinkedIn {{company}}',
      emailSubjectTemplate: 'Subject {{position}}',
      emailBodyTemplate: 'Body {{firstName}}',
      companyDomains: {
        ' Acmé, Inc. ': '@Jobs.Example.COM',
        '__proto__': 'unsafe.example.com',
        invalid: 'https://invalid.example.com',
      },
      profileUrl: 'https://linkedin.com/in/ada-lovelace',
      firstName: 'Ada',
      selectedRecipient: 'ada@example.com',
      renderedBody: 'ephemeral',
    } as unknown as OutreachPreferences

    expect(saveOutreachPreferences('user-a', unsafe, storage)).toBe(true)
    const userAKey = outreachPreferencesStorageKey('user-a')!
    const serialized = values.get(userAKey)
    expect(serialized).toBeDefined()
    expect(JSON.parse(serialized!)).toEqual({
      linkedInTemplate: 'LinkedIn {{company}}',
      emailSubjectTemplate: 'Subject {{position}}',
      emailBodyTemplate: 'Body {{firstName}}',
      companyDomains: { 'acme inc': 'jobs.example.com' },
    })
    expect(serialized).not.toMatch(
      /"(?:profileUrl|firstName|selectedRecipient|renderedBody)":/u,
    )
    expect(loadOutreachPreferences('user-a', storage)).toEqual({
      linkedInTemplate: 'LinkedIn {{company}}',
      emailSubjectTemplate: 'Subject {{position}}',
      emailBodyTemplate: 'Body {{firstName}}',
      companyDomains: { 'acme inc': 'jobs.example.com' },
    })
    expect(loadOutreachPreferences('user-b', storage)).toEqual(defaultOutreachPreferences())
  })

  it('returns fresh complete defaults for absent, malformed, or wrong-shaped data', () => {
    const defaults = defaultOutreachPreferences()
    expect(defaults).toEqual({
      linkedInTemplate: DEFAULT_LINKEDIN_TEMPLATE,
      emailSubjectTemplate: DEFAULT_EMAIL_SUBJECT_TEMPLATE,
      emailBodyTemplate: DEFAULT_EMAIL_BODY_TEMPLATE,
      companyDomains: {},
    })
    expect(defaultOutreachPreferences()).not.toBe(defaults)
    expect(defaultOutreachPreferences().companyDomains).not.toBe(defaults.companyDomains)

    for (const value of [
      '{not-json',
      '[]',
      'null',
      JSON.stringify({ linkedInTemplate: 42 }),
      JSON.stringify({
        linkedInTemplate: 'LinkedIn',
        emailSubjectTemplate: 'Subject',
        emailBodyTemplate: 'Body',
        companyDomains: [],
      }),
    ]) {
      const key = outreachPreferencesStorageKey('user-a')!
      expect(loadOutreachPreferences('user-a', memoryStorage({ [key]: value }).storage))
        .toEqual(defaults)
    }
  })

  it('keeps composing usable when storage is absent, blocked, or unnamespaced', () => {
    const blocked: OutreachStorage = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    const available = memoryStorage()

    expect(loadOutreachPreferences('user-a', null)).toEqual(defaultOutreachPreferences())
    expect(loadOutreachPreferences('user-a', blocked)).toEqual(defaultOutreachPreferences())
    expect(loadOutreachPreferences('', available.storage)).toEqual(defaultOutreachPreferences())
    expect(saveOutreachPreferences('user-a', defaultOutreachPreferences(), null)).toBe(false)
    expect(saveOutreachPreferences('user-a', defaultOutreachPreferences(), blocked)).toBe(false)
    expect(saveOutreachPreferences('', defaultOutreachPreferences(), available.storage)).toBe(false)
    expect(available.writes).toEqual([])
  })

  it('filters invalid and prototype-like domain entries while loading', () => {
    const key = outreachPreferencesStorageKey('user-a')!
    const stored = JSON.stringify({
      linkedInTemplate: 'LinkedIn',
      emailSubjectTemplate: 'Subject',
      emailBodyTemplate: 'Body',
      companyDomains: {
        Acme: 'Example.COM',
        constructor: 'unsafe.example.com',
        prototype: 'unsafe.example.com',
        'Bad Domain': 'https://example.com',
      },
    })

    expect(loadOutreachPreferences('user-a', memoryStorage({ [key]: stored }).storage))
      .toEqual({
        linkedInTemplate: 'LinkedIn',
        emailSubjectTemplate: 'Subject',
        emailBodyTemplate: 'Body',
        companyDomains: { acme: 'example.com' },
      })
  })
})

describe('browser-only deterministic scope', () => {
  it('has no framework, service client, request, enrichment, AI, or send dependency', () => {
    expect(outreachSource).not.toMatch(/from ['"]react['"]/u)
    expect(outreachSource).not.toMatch(/supabase|XMLHttpRequest|\bfetch\s*\(|openai|gmail api|microsoft graph|mail api|oauth|scrap|enrich|sendmail/iu)
  })

  it('completes representative synchronous derivations under one second', () => {
    const started = performance.now()
    let final = ''
    for (let index = 0; index < 1_000; index += 1) {
      final = renderOutreachTemplate(DEFAULT_EMAIL_BODY_TEMPLATE, {
        firstName: 'Ada',
        company: 'Acme',
        position: 'Analyst',
      })
      generateEmailPossibilities({
        firstName: 'Ada',
        lastName: 'Lovelace',
        domain: 'example.com',
      })
      outlookComposeUrl({ recipient: 'ada@example.com', subject: 'Hi', body: final })
    }
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(final).toContain('Ada')
  })
})

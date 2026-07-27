import { describe, expect, it } from 'vitest'
import {
  ALLOWED_BRANDED_CATEGORY_TERMS,
  createBrandedScopeEvidence,
  createGoldmanHigherScopeEvidence,
  findAllowedBrandedCategoryTerm,
  findAllowedBrandedCategoryTermForSource,
  hasUnitedStatesDetailEvidence,
  matchesAllowedProviderCategory,
} from '../../supabase/functions/_shared/adapters/scope'
import {
  isCredibleCompleteObservation,
  planCompanySync,
} from '../../supabase/functions/_shared/lifecycle'
import type {
  NormalizedJob,
  PollObservation,
} from '../../supabase/functions/_shared/adapters/types'

describe('branded provider category scope', () => {
  it('exposes only the seven locked provider-category terms', () => {
    expect(ALLOWED_BRANDED_CATEGORY_TERMS).toEqual([
      'Data',
      'Technology',
      'Finance',
      'Investment',
      'Research',
      'Risk',
      'Capital Markets',
    ])
    expect(Object.isFrozen(ALLOWED_BRANDED_CATEGORY_TERMS)).toBe(true)
  })

  it.each([
    ['Data & Analytics', 'Data'],
    ['enterprise TECHNOLOGY', 'Technology'],
    ['Corporate-finance', 'Finance'],
    ['Investment Management', 'Investment'],
    ['quantitative/research', 'Research'],
    ['Credit Risk', 'Risk'],
    ['Capital Markets Technology', 'Capital Markets'],
    ['Ｃａｐｉｔａｌ　Ｍａｒｋｅｔｓ', 'Capital Markets'],
    ['Data\t\n  & Analytics', 'Data'],
  ])('matches normalized whole term in %s', (label, matchedTerm) => {
    expect(matchesAllowedProviderCategory(label)).toBe(true)
    expect(findAllowedBrandedCategoryTerm(label)).toBe(matchedTerm)
  })

  it.each([
    '',
    'Database Administration',
    'Technologies',
    'Finances',
    'Investmentbanking',
    'Researchers',
    'Risk2',
    'Credit Рisk',
    'Data分析',
    '研究Data',
    'Capital Marketplace',
    null,
    undefined,
  ])('rejects substring, Unicode-adjacent, or missing category evidence %s', (label) => {
    expect(matchesAllowedProviderCategory(label)).toBe(false)
    expect(findAllowedBrandedCategoryTerm(label)).toBeNull()
  })

  it('does not inspect title or description when provider category is absent', () => {
    const providerPayload = {
      category: undefined,
      title: 'Data Research Analyst',
      description: 'Capital Markets Technology and Finance',
    }
    expect(matchesAllowedProviderCategory(providerPayload.category)).toBe(false)
  })
})

describe('United States detail evidence', () => {
  it('accepts only the exact job-detail country code', () => {
    expect(hasUnitedStatesDetailEvidence('US')).toBe(true)
  })

  it.each([
    '',
    'us',
    'USA',
    'United States',
    'United States of America',
    'US ',
    null,
    undefined,
  ])('rejects missing or non-exact detail evidence %s', (countryCode) => {
    expect(hasUnitedStatesDetailEvidence(countryCode)).toBe(false)
  })
})

describe('durable branded scope evidence', () => {
  const goldmanInput = {
    sourceKey: 'goldman_higher:roles' as const,
    externalId: '180084_GS_MID_CAREER',
    providerSourceId: '180084',
    providerCategoryField: 'jobFunction' as const,
    providerCategoryLabel: 'Capital Markets Technology',
    detailCountryCode: 'US' as const,
    postedAt: '2026-07-24T18:03:34.000Z',
    recruitingType: 'GS_MID_CAREER' as const,
    selectionMode: 'recent_exact_us_provider_category' as const,
    recentHours: 168 as const,
  }

  it.each([
    ['Finance', 'Finance'],
    ['Data & Analytics', 'Data'],
    ['Risk', 'Risk'],
    ['Product/Investment Mgmt', 'Investment'],
    ['Strategy & Development', 'Strategy'],
    ['Program Analysts & Associate', 'Program Analysts'],
  ])('maps exact JPMorgan family %s to %s', (label, matchedTerm) => {
    expect(findAllowedBrandedCategoryTermForSource(
      'oracle:jpmc:CX_1001',
      label,
    )).toBe(matchedTerm)
  })

  it.each([
    'Credit Risk',
    'Finance Strategy',
    'Strategy',
    'Program Analysts',
    'Program Analysts & Associates',
  ])('rejects non-exact JPMorgan provider family %s', (label) => {
    expect(findAllowedBrandedCategoryTermForSource(
      'oracle:jpmc:CX_1001',
      label,
    )).toBeNull()
  })

  it.each([
    'Strategy & Development',
    'Program Analysts & Associate',
  ])('does not widen generic sibling provider evidence with %s', async (label) => {
    expect(findAllowedBrandedCategoryTermForSource(
      'eightfold:morganstanley',
      label,
    )).toBeNull()
    expect(findAllowedBrandedCategoryTermForSource(
      'goldman_higher:roles',
      label,
    )).toBeNull()
  })

  it('creates bounded immutable provenance whose digest is bound to external ID', async () => {
    const evidence = await createBrandedScopeEvidence({
      sourceKey: 'oracle:jpmc:CX_1001',
      externalId: 'job-123',
      providerCategoryLabel: '  Data  & Analytics  ',
      detailCountryCode: 'US',
    })
    const otherExternalId = await createBrandedScopeEvidence({
      sourceKey: 'oracle:jpmc:CX_1001',
      externalId: 'job-124',
      providerCategoryLabel: 'Data & Analytics',
      detailCountryCode: 'US',
    })

    expect(evidence).toEqual({
      sourceKey: 'oracle:jpmc:CX_1001',
      providerCategoryLabel: 'data analytics',
      matchedTerm: 'Data',
      detailCountryCode: 'US',
      externalIdDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(evidence.externalIdDigest).not.toBe(otherExternalId.externalIdDigest)
    expect(Object.isFrozen(evidence)).toBe(true)
  })

  it('creates exact immutable Goldman evidence with field-preserving category proof', async () => {
    const evidence = await createGoldmanHigherScopeEvidence(goldmanInput)

    expect(evidence).toEqual({
      sourceKey: 'goldman_higher:roles',
      selectionMode: 'recent_exact_us_provider_category',
      recentHours: 168,
      providerSourceId: '180084',
      providerCategoryField: 'jobFunction',
      providerCategoryLabel: 'capital markets technology',
      matchedTerm: 'Capital Markets',
      detailCountryCode: 'US',
      postedAt: '2026-07-24T18:03:34.000Z',
      recruitingType: 'GS_MID_CAREER',
      externalIdDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(Object.isFrozen(evidence)).toBe(true)
  })

  it.each([
    ['externalId', '180085_GS_MID_CAREER'],
    ['providerSourceId', '180085'],
    ['providerCategoryField', 'division'],
    ['providerCategoryLabel', 'Investment Research'],
    ['postedAt', '2026-07-24T18:03:35.000Z'],
    ['recruitingType', 'GS_EARLY_CAREER'],
  ] as const)('binds Goldman digest to %s', async (field, value) => {
    const baseline = await createGoldmanHigherScopeEvidence(goldmanInput)
    const changed = await createGoldmanHigherScopeEvidence({
      ...goldmanInput,
      [field]: value,
    })
    expect(changed.externalIdDigest).not.toBe(baseline.externalIdDigest)
  })

  it.each([
    { providerSourceId: 'not-numeric' },
    { providerCategoryField: 'title' },
    { providerCategoryLabel: 'Database Administration' },
    { detailCountryCode: 'USA' },
    { postedAt: '2026-07-24' },
    { recruitingType: 'CAMPUS' },
    { selectionMode: 'recent_exact_us' },
    { recentHours: 167 },
  ])('rejects drifted Goldman evidence %#', async (change) => {
    await expect(createGoldmanHigherScopeEvidence({
      ...goldmanInput,
      ...change,
    } as never)).rejects.toThrow()
  })

  it.each([
    {
      sourceKey: 'oracle:jpmc:CX_1002',
      externalId: 'job-123',
      providerCategoryLabel: 'Risk',
      detailCountryCode: 'US',
    },
    {
      sourceKey: 'eightfold:morganstanley',
      externalId: '',
      providerCategoryLabel: 'Data',
      detailCountryCode: 'US',
    },
    {
      sourceKey: 'goldman_higher:roles',
      externalId: 'job-123',
      providerCategoryLabel: 'Database Administration',
      detailCountryCode: 'US',
    },
    {
      sourceKey: 'goldman_higher:roles',
      externalId: 'job-123',
      providerCategoryLabel: 'Risk',
      detailCountryCode: 'USA',
    },
    {
      sourceKey: 'goldman_higher:roles',
      externalId: 'job-123',
      providerCategoryLabel: `Risk ${'x'.repeat(200)}`,
      detailCountryCode: 'US',
    },
  ])('rejects unbounded or incomplete scope evidence %#', async (input) => {
    await expect(createBrandedScopeEvidence(input)).rejects.toThrow()
  })

  it('requires scope evidence for branded normalized jobs and keeps partial observations closure-ineligible', async () => {
    const scopeEvidence = await createBrandedScopeEvidence({
      sourceKey: 'eightfold:morganstanley',
      externalId: 'ms-1',
      providerCategoryLabel: 'Data & Analytics',
      detailCountryCode: 'US',
    })
    const job = {
      source: 'eightfold',
      externalId: 'ms-1',
      title: 'Analyst',
      location: 'New York, NY, United States',
      absoluteUrl: 'https://morganstanley.eightfold.ai/careers/job/ms-1',
      postedAt: null,
      descriptionHtml: null,
      descriptionText: 'Role details',
      snapshotPartial: false,
      companyName: 'Morgan Stanley',
      scopeEvidence,
    } satisfies NormalizedJob
    const observation = {
      jobs: [job],
      completeness: 'partial',
      credibleForClosure: false,
      allowMissingClosure: false,
      pageCount: 1,
      expectedCount: 2,
      warnings: ['detail_evidence_incomplete'],
      scopeEvidence: Object.freeze({
        sourceKey: 'eightfold:morganstanley',
        sliceDigests: Object.freeze(['a'.repeat(64)]),
        categoryDigest: 'b'.repeat(64),
        countryDigest: 'c'.repeat(64),
      }),
    } satisfies PollObservation

    expect(isCredibleCompleteObservation(observation)).toBe(false)
    expect(planCompanySync([{
      id: 'existing-1',
      source: 'eightfold',
      external_id: 'missing-upstream',
      fingerprint: 'fingerprint',
      status: 'open',
      last_seen_at: '2026-01-01T00:00:00.000Z',
    }], observation, '2026-01-02T00:00:00.000Z').closeIds).toEqual([])
  })
})

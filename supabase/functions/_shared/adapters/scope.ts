import type {
  BrandedJobScopeEvidence,
  BrandedJobSourceKey,
  GoldmanHigherJobScopeEvidence,
  GoldmanHigherRecruitingType,
} from './types.ts'

export const ALLOWED_BRANDED_CATEGORY_TERMS = Object.freeze([
  'Data',
  'Technology',
  'Finance',
  'Investment',
  'Research',
  'Risk',
  'Capital Markets',
] as const)

export type AllowedBrandedCategoryTerm =
  typeof ALLOWED_BRANDED_CATEGORY_TERMS[number]

const JPMC_PROVIDER_FAMILY_TERMS = Object.freeze({
  finance: 'Finance',
  'data analytics': 'Data',
  risk: 'Risk',
  'product investment mgmt': 'Investment',
  'strategy development': 'Strategy',
  'program analysts associate': 'Program Analysts',
} as const satisfies Readonly<Record<string, BrandedJobScopeEvidence['matchedTerm']>>)

const BRANDED_SOURCE_KEYS = new Set<BrandedJobSourceKey>([
  'eightfold:morganstanley',
  'oracle:jpmc:CX_1001',
  'goldman_higher:roles',
])
const MAX_CATEGORY_CODE_POINTS = 160
const MAX_CATEGORY_BYTES = 512
const MAX_EXTERNAL_ID_CODE_POINTS = 256
const MAX_EXTERNAL_ID_BYTES = 512
const textEncoder = new TextEncoder()

function codePointLength(value: string): number {
  return [...value].length
}

function isBounded(
  value: string,
  maxCodePoints: number,
  maxBytes: number,
): boolean {
  return value.length > 0
    && codePointLength(value) <= maxCodePoints
    && textEncoder.encode(value).byteLength <= maxBytes
    && !/[\p{Cc}\p{Cf}]/u.test(value)
}

function categoryTokens(value: string): string[] {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .match(/[\p{L}\p{N}]+/gu) ?? []
}

function normalizedCategoryLabel(value: string): string {
  return categoryTokens(value).join(' ')
}

function containsTokenSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) return false
  for (let index = 0; index + needle.length <= haystack.length; index += 1) {
    if (needle.every((token, offset) => haystack[index + offset] === token)) {
      return true
    }
  }
  return false
}

export function findAllowedBrandedCategoryTerm(
  providerCategoryLabel: string | null | undefined,
): AllowedBrandedCategoryTerm | null {
  if (typeof providerCategoryLabel !== 'string') return null
  const labelTokens = categoryTokens(providerCategoryLabel)
  if (labelTokens.length === 0) return null

  const termsBySpecificity = [...ALLOWED_BRANDED_CATEGORY_TERMS]
    .sort((left, right) => categoryTokens(right).length - categoryTokens(left).length)
  for (const term of termsBySpecificity) {
    if (containsTokenSequence(labelTokens, categoryTokens(term))) return term
  }
  return null
}

export function findAllowedBrandedCategoryTermForSource(
  sourceKey: string,
  providerCategoryLabel: string | null | undefined,
): BrandedJobScopeEvidence['matchedTerm'] | null {
  if (typeof providerCategoryLabel !== 'string') return null
  if (sourceKey !== 'oracle:jpmc:CX_1001') {
    return findAllowedBrandedCategoryTerm(providerCategoryLabel)
  }
  const normalizedLabel = normalizedCategoryLabel(providerCategoryLabel)
  return JPMC_PROVIDER_FAMILY_TERMS[
    normalizedLabel as keyof typeof JPMC_PROVIDER_FAMILY_TERMS
  ] ?? null
}

export function matchesAllowedProviderCategory(
  providerCategoryLabel: string | null | undefined,
): boolean {
  return findAllowedBrandedCategoryTerm(providerCategoryLabel) !== null
}

export function hasUnitedStatesDetailEvidence(
  detailCountryCode: unknown,
): detailCountryCode is 'US' {
  return detailCountryCode === 'US'
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export interface CreateBrandedScopeEvidenceInput {
  sourceKey: string
  externalId: string
  providerCategoryLabel: string
  detailCountryCode: string
}

export interface CreateGoldmanHigherScopeEvidenceInput {
  sourceKey: 'goldman_higher:roles'
  externalId: string
  selectionMode: 'recent_exact_us_provider_category'
  recentHours: 168
  providerSourceId: string
  providerCategoryField: 'jobFunction' | 'division'
  providerCategoryLabel: string
  detailCountryCode: 'US'
  postedAt: string
  recruitingType: GoldmanHigherRecruitingType
}

export async function createGoldmanHigherScopeEvidence(
  input: CreateGoldmanHigherScopeEvidenceInput,
): Promise<GoldmanHigherJobScopeEvidence> {
  if (input.sourceKey !== 'goldman_higher:roles') {
    throw new Error('unsupported_branded_source')
  }
  if (input.selectionMode !== 'recent_exact_us_provider_category') {
    throw new Error('invalid_selection_mode')
  }
  if (input.recentHours !== 168) throw new Error('invalid_recent_hours')
  if (!isBounded(input.externalId, MAX_EXTERNAL_ID_CODE_POINTS, MAX_EXTERNAL_ID_BYTES)) {
    throw new Error('invalid_external_id')
  }
  if (
    !isBounded(
      input.providerSourceId,
      MAX_EXTERNAL_ID_CODE_POINTS,
      MAX_EXTERNAL_ID_BYTES,
    )
    || !/^[0-9]+$/.test(input.providerSourceId)
  ) {
    throw new Error('invalid_provider_source_id')
  }
  if (
    input.providerCategoryField !== 'jobFunction'
    && input.providerCategoryField !== 'division'
  ) {
    throw new Error('invalid_provider_category_field')
  }
  if (!isBounded(
    input.providerCategoryLabel,
    MAX_CATEGORY_CODE_POINTS,
    MAX_CATEGORY_BYTES,
  )) {
    throw new Error('invalid_provider_category')
  }
  const matchedTerm = findAllowedBrandedCategoryTerm(input.providerCategoryLabel)
  if (!matchedTerm) throw new Error('provider_category_ineligible')
  if (!hasUnitedStatesDetailEvidence(input.detailCountryCode)) {
    throw new Error('detail_country_ineligible')
  }
  const postedAtEpoch = Date.parse(input.postedAt)
  if (
    !Number.isFinite(postedAtEpoch)
    || new Date(postedAtEpoch).toISOString() !== input.postedAt
  ) {
    throw new Error('invalid_posted_at')
  }
  if (
    input.recruitingType !== 'GS_EARLY_CAREER'
    && input.recruitingType !== 'GS_MID_CAREER'
  ) {
    throw new Error('invalid_recruiting_type')
  }

  const providerCategoryLabel = normalizedCategoryLabel(input.providerCategoryLabel)
  const externalIdDigest = await sha256Hex(JSON.stringify([
    input.sourceKey,
    input.externalId,
    input.selectionMode,
    input.recentHours,
    input.providerSourceId,
    input.providerCategoryField,
    providerCategoryLabel,
    matchedTerm,
    'US',
    input.postedAt,
    input.recruitingType,
  ]))

  return Object.freeze({
    sourceKey: input.sourceKey,
    selectionMode: input.selectionMode,
    recentHours: input.recentHours,
    providerSourceId: input.providerSourceId,
    providerCategoryField: input.providerCategoryField,
    providerCategoryLabel,
    matchedTerm,
    detailCountryCode: 'US',
    postedAt: input.postedAt,
    recruitingType: input.recruitingType,
    externalIdDigest,
  })
}

export async function createBrandedScopeEvidence(
  input: CreateBrandedScopeEvidenceInput,
): Promise<BrandedJobScopeEvidence> {
  if (!BRANDED_SOURCE_KEYS.has(input.sourceKey as BrandedJobSourceKey)) {
    throw new Error('unsupported_branded_source')
  }
  if (!isBounded(input.externalId, MAX_EXTERNAL_ID_CODE_POINTS, MAX_EXTERNAL_ID_BYTES)) {
    throw new Error('invalid_external_id')
  }
  if (!isBounded(
    input.providerCategoryLabel,
    MAX_CATEGORY_CODE_POINTS,
    MAX_CATEGORY_BYTES,
  )) {
    throw new Error('invalid_provider_category')
  }
  const matchedTerm = findAllowedBrandedCategoryTermForSource(
    input.sourceKey,
    input.providerCategoryLabel,
  )
  if (!matchedTerm) throw new Error('provider_category_ineligible')
  if (!hasUnitedStatesDetailEvidence(input.detailCountryCode)) {
    throw new Error('detail_country_ineligible')
  }

  const sourceKey = input.sourceKey as BrandedJobSourceKey
  const providerCategoryLabel = normalizedCategoryLabel(input.providerCategoryLabel)
  const externalIdDigest = await sha256Hex(JSON.stringify([
    sourceKey,
    input.externalId,
    providerCategoryLabel,
    matchedTerm,
    'US',
  ]))

  return Object.freeze({
    sourceKey,
    providerCategoryLabel,
    matchedTerm,
    detailCountryCode: 'US',
    externalIdDigest,
  })
}

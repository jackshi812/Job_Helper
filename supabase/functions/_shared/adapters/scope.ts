import type {
  BrandedJobScopeEvidence,
  BrandedJobSourceKey,
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
  const matchedTerm = findAllowedBrandedCategoryTerm(input.providerCategoryLabel)
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

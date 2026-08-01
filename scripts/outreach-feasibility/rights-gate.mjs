#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const MAX_RIGHTS_VALIDITY_DAYS = 7
export const REQUIRED_OPERATIONS = Object.freeze([
  'public_search',
  'transient_owner_review',
  'persist_profile_url',
  'persist_title_reason',
  'manual_networking_purpose',
  'delete_local_raw_responses',
  'provider_retention',
])
export const OFFICIAL_RIGHTS_SOURCE_CONTRACTS = Object.freeze({
  'linkedin-user-agreement': Object.freeze({
    protocol: 'https:',
    hostname: 'www.linkedin.com',
    pathname: '/legal/user-agreement',
    clause_family: '8.2(4), 8.2(12), and section 8 permission preface',
  }),
  'linkedin-crawling-terms': Object.freeze({
    protocol: 'https:',
    hostname: 'www.linkedin.com',
    pathname: '/legal/crawling-terms',
    clause_family: 'Permission and permitted-use provisions',
  }),
  'linkedin-robots': Object.freeze({
    protocol: 'https:',
    hostname: 'www.linkedin.com',
    pathname: '/robots.txt',
    clause_family: 'Automated-access notice and User-agent wildcard rules',
  }),
  'linkedin-public-profile-visibility': Object.freeze({
    protocol: 'https:',
    hostname: 'www.linkedin.com',
    pathname: '/help/linkedin/answer/a520838/',
    clause_family: 'Public profile visibility and search-engine refresh guidance',
  }),
  'tavily-platform-terms': Object.freeze({
    protocol: 'https:',
    hostname: 'www.tavily.com',
    pathname: '/terms',
    clause_family: 'Output, Customer Application, third-party rights, and retention provisions',
  }),
  'tavily-acceptable-use-policy': Object.freeze({
    protocol: 'https:',
    hostname: 'www.tavily.com',
    pathname: '/acceptable-use-policy',
    clause_family: 'Third-party obligations and unsolicited promotional communications provisions',
  }),
  'tavily-privacy-policy': Object.freeze({
    protocol: 'https:',
    hostname: 'www.tavily.com',
    pathname: '/privacy',
    clause_family: 'Query sharing, retention, and deletion provisions',
  }),
  'tavily-faq-retention': Object.freeze({
    protocol: 'https:',
    hostname: 'docs.tavily.com',
    pathname: '/faq/faq',
    clause_family: 'Zero data retention FAQ entry',
  }),
})

const OPTIONAL_OPERATION = 'company_level_cache'
const MATRIX_KEYS = Object.freeze([
  'schema_version',
  'phase',
  'researched_at',
  'valid_until',
  'sources',
  'operations',
  'rights_evidence_sha256',
])
const SOURCE_KEYS = Object.freeze([
  'source_id',
  'official_url',
  'source_date_marker',
  'retrieved_at',
  'clause_id',
  'short_paraphrase',
  'evidence_sha256',
])
const OPERATION_KEYS = Object.freeze([
  'operation',
  'required',
  'status',
  'evidence_refs',
])
const QUALITY_KEYS = Object.freeze([
  'schema_version',
  'phase',
  'status',
  'rights_status',
  'search_authorized',
  'rights_evidence_sha256',
  'quality_evidence_sha256',
  'cases',
  'provider_call_count',
  'fixture_count',
  'raw_result_count',
  'production_mutation_count',
])
const RIGHTS_STATUSES = new Set([
  'ALLOW',
  'PROHIBIT',
  'AMBIGUOUS',
  'NOT_APPLICABLE',
])
const SHA256 = /^[0-9a-f]{64}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const UTC_ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const SOURCE_ID = /^[a-z][a-z0-9-]*$/
const UTC_DAY_MS = 24 * 60 * 60 * 1000
const CANDIDATE_DATA_KEY =
  /(?:candidate|linkedin|profile|person|full_name|snippet|source_page|apply_url|current_title)/i

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function requireExactKeys(value, expected, label) {
  requireCondition(isPlainObject(value), `${label} must be an object`)
  const expectedSet = new Set(expected)
  for (const key of Object.keys(value)) {
    requireCondition(expectedSet.has(key), `${label} has unknown key: ${key}`)
  }
  for (const key of expected) {
    requireCondition(Object.hasOwn(value, key), `${label} is missing key: ${key}`)
  }
}

function requireNonEmptyString(value, label, maxLength = 500) {
  requireCondition(
    typeof value === 'string'
      && value.length > 0
      && value.length <= maxLength
      && value.trim() === value,
    `${label} is malformed`,
  )
}

function parseIsoDate(value, label) {
  requireCondition(typeof value === 'string' && ISO_DATE.test(value), `${label} is malformed`)
  const timestamp = Date.parse(`${value}T00:00:00.000Z`)
  requireCondition(
    Number.isFinite(timestamp)
      && new Date(timestamp).toISOString().startsWith(value),
    `${label} is malformed`,
  )
  return timestamp
}

function parseNow(now) {
  const date = now instanceof Date ? now : new Date(now)
  requireCondition(Number.isFinite(date.getTime()), 'current time is malformed')
  return date
}

function parseUtcIsoTimestamp(value, label) {
  requireCondition(
    typeof value === 'string' && UTC_ISO_TIMESTAMP.test(value),
    `${label} is malformed`,
  )
  const timestamp = Date.parse(value)
  const canonicalTimestamp = value.includes('.')
    ? value
    : value.replace('Z', '.000Z')
  requireCondition(
    Number.isFinite(timestamp)
      && new Date(timestamp).toISOString() === canonicalTimestamp,
    `${label} is malformed`,
  )
  return timestamp
}

export function canonical(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonical(item)).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonical(value[key])}`,
    ).join(',')}}`
  }
  const serialized = JSON.stringify(value)
  requireCondition(serialized !== undefined, 'value is not JSON serializable')
  return serialized
}

export function sha256Json(value) {
  return createHash('sha256')
    .update(`${canonical(value)}\n`, 'utf8')
    .digest('hex')
}

function validateSource(
  source,
  sourceIds,
  { researchedAt, validityEnd, nowMs },
) {
  requireExactKeys(source, SOURCE_KEYS, 'source evidence')
  requireCondition(
    typeof source.source_id === 'string' && SOURCE_ID.test(source.source_id),
    'source_id is malformed',
  )
  requireCondition(!sourceIds.has(source.source_id), 'duplicate source_id')

  let officialUrl
  try {
    officialUrl = new URL(source.official_url)
  } catch {
    throw new Error('official_url is malformed')
  }
  requireCondition(
    officialUrl.protocol === 'https:'
      && officialUrl.username === ''
      && officialUrl.password === '',
    'official_url must be credential-free HTTPS',
  )
  const officialContract = OFFICIAL_RIGHTS_SOURCE_CONTRACTS[source.source_id]
  requireCondition(
    officialContract !== undefined,
    'source_id has no official rights source contract',
  )
  const canonicalOfficialUrl =
    `${officialContract.protocol}//${officialContract.hostname}${officialContract.pathname}`
  requireCondition(
    source.official_url === canonicalOfficialUrl
      && officialUrl.protocol === officialContract.protocol
      && officialUrl.hostname === officialContract.hostname
      && officialUrl.port === ''
      && officialUrl.pathname === officialContract.pathname
      && officialUrl.search === ''
      && officialUrl.hash === '',
    'official_url violates official rights source contract',
  )
  requireNonEmptyString(source.source_date_marker, 'source_date_marker')
  const retrievedAt = parseUtcIsoTimestamp(source.retrieved_at, 'retrieved_at')
  requireCondition(
    retrievedAt >= researchedAt,
    'retrieved_at is before the research window',
  )
  requireCondition(
    retrievedAt <= validityEnd,
    'retrieved_at is after the validity window',
  )
  requireCondition(retrievedAt <= nowMs, 'retrieved_at is future-dated')
  requireNonEmptyString(source.clause_id, 'clause_id')
  requireCondition(
    source.clause_id === officialContract.clause_family,
    'clause_id violates official rights source contract',
  )
  requireNonEmptyString(source.short_paraphrase, 'short_paraphrase')
  requireCondition(
    !/<(?:html|body|script|article)\b/i.test(source.short_paraphrase),
    'short_paraphrase contains policy-page markup',
  )
  requireCondition(SHA256.test(source.evidence_sha256), 'evidence_sha256 is malformed')
  const { evidence_sha256, ...evidenceBody } = source
  requireCondition(
    evidence_sha256 === sha256Json(evidenceBody),
    'source evidence digest mismatch',
  )
  sourceIds.add(source.source_id)
}

function validateOperation(operation, sourceIds, operationNames) {
  requireExactKeys(operation, OPERATION_KEYS, 'operation')
  requireNonEmptyString(operation.operation, 'operation name', 100)
  requireCondition(
    REQUIRED_OPERATIONS.includes(operation.operation)
      || operation.operation === OPTIONAL_OPERATION,
    `unknown operation: ${operation.operation}`,
  )
  requireCondition(!operationNames.has(operation.operation), 'duplicate operation')
  requireCondition(
    operation.required === REQUIRED_OPERATIONS.includes(operation.operation),
    `required flag drift for ${operation.operation}`,
  )
  requireCondition(RIGHTS_STATUSES.has(operation.status), 'operation status is unknown')
  requireCondition(
    Array.isArray(operation.evidence_refs) && operation.evidence_refs.length > 0,
    'operation evidence_refs must be non-empty',
  )
  const references = new Set()
  for (const reference of operation.evidence_refs) {
    requireCondition(
      typeof reference === 'string' && sourceIds.has(reference),
      'operation has unresolved evidence reference',
    )
    requireCondition(!references.has(reference), 'duplicate evidence reference')
    references.add(reference)
  }
  operationNames.add(operation.operation)
}

export function inspectRightsMatrix(matrix, { now = new Date() } = {}) {
  requireExactKeys(matrix, MATRIX_KEYS, 'rights matrix')
  requireCondition(matrix.schema_version === 1, 'schema_version must equal 1')
  requireCondition(matrix.phase === '05', 'phase must equal 05')

  const researchedAt = parseIsoDate(matrix.researched_at, 'researched_at')
  const validUntil = parseIsoDate(matrix.valid_until, 'valid_until')
  requireCondition(researchedAt <= validUntil, 'research validity window is malformed')
  const nowMs = parseNow(now).getTime()
  requireCondition(researchedAt <= nowMs, 'researched_at is future-dated')
  const validityEnd = validUntil + UTC_DAY_MS - 1

  requireCondition(Array.isArray(matrix.sources) && matrix.sources.length > 0,
    'sources must be non-empty')
  const sourceIds = new Set()
  for (const source of matrix.sources) {
    validateSource(source, sourceIds, { researchedAt, validityEnd, nowMs })
  }
  requireCondition(nowMs <= validityEnd, 'rights evidence is stale')

  requireCondition(
    Array.isArray(matrix.operations)
      && matrix.operations.length === REQUIRED_OPERATIONS.length + 1,
    'operations must contain the exact required and optional set',
  )
  const operationNames = new Set()
  for (const operation of matrix.operations) {
    validateOperation(operation, sourceIds, operationNames)
  }
  for (const name of [...REQUIRED_OPERATIONS, OPTIONAL_OPERATION]) {
    requireCondition(operationNames.has(name), `missing operation: ${name}`)
  }

  requireCondition(
    matrix.operations.some(
      (row) => row.operation === 'delete_local_raw_responses' && row.required === true,
    ),
    'local deletion operation is missing',
  )
  requireCondition(
    matrix.operations.some(
      (row) => row.operation === 'provider_retention' && row.required === true,
    ),
    'provider retention operation is missing',
  )
  requireCondition(
    matrix.operations.some(
      (row) => row.operation === OPTIONAL_OPERATION && row.required === false,
    ),
    'optional company cache operation is missing',
  )

  requireCondition(
    typeof matrix.rights_evidence_sha256 === 'string'
      && SHA256.test(matrix.rights_evidence_sha256),
    'rights_evidence_sha256 is malformed',
  )
  const { rights_evidence_sha256, ...matrixBody } = matrix
  requireCondition(
    rights_evidence_sha256 === sha256Json(matrixBody),
    'aggregate rights evidence digest mismatch',
  )

  return matrix
}

export function validateRightsMatrix(matrix, options = {}) {
  inspectRightsMatrix(matrix, options)
  const researchedAt = parseIsoDate(matrix.researched_at, 'researched_at')
  const validUntil = parseIsoDate(matrix.valid_until, 'valid_until')
  requireCondition(
    validUntil - researchedAt
      <= (MAX_RIGHTS_VALIDITY_DAYS - 1) * UTC_DAY_MS,
    'rights validity exceeds seven inclusive UTC dates',
  )
  return matrix
}

function zeroEffectVerdict(status, searchAuthorized, qualityStatus) {
  return {
    status,
    search_authorized: searchAuthorized,
    quality_status: qualityStatus,
    provider_call_count: 0,
    fixture_count: 0,
    raw_result_count: 0,
    production_mutation_count: 0,
  }
}

export function evaluateRights(matrix, options = {}) {
  try {
    validateRightsMatrix(matrix, options)
    const operations = new Map(
      matrix.operations
        .filter((row) => row.required)
        .map((row) => [row.operation, row]),
    )
    const permitted = REQUIRED_OPERATIONS.every(
      (name) => operations.get(name)?.status === 'ALLOW',
    )
    return permitted
      ? zeroEffectVerdict('PASS', true, null)
      : zeroEffectVerdict('RIGHTS_NO_GO', false, 'NOT_RUN_RIGHTS_NO_GO')
  } catch {
    return zeroEffectVerdict('RIGHTS_NO_GO', false, 'NOT_RUN_RIGHTS_NO_GO')
  }
}

function qualityBody(matrix) {
  return {
    schema_version: 1,
    phase: '05',
    status: 'NOT_RUN_RIGHTS_NO_GO',
    rights_status: 'RIGHTS_NO_GO',
    search_authorized: false,
    rights_evidence_sha256: matrix.rights_evidence_sha256,
    cases: [],
    provider_call_count: 0,
    fixture_count: 0,
    raw_result_count: 0,
    production_mutation_count: 0,
  }
}

export function buildNoGoQualityReport(matrix, options = {}) {
  inspectRightsMatrix(matrix, options)
  const verdict = evaluateRights(matrix, options)
  requireCondition(
    verdict.status === 'RIGHTS_NO_GO' && verdict.search_authorized === false,
    'cannot build no-go evidence for an authorized matrix',
  )
  const body = qualityBody(matrix)
  return {
    ...body,
    quality_evidence_sha256: sha256Json(body),
  }
}

function containsCandidateData(value) {
  if (Array.isArray(value)) return value.some((item) => containsCandidateData(item))
  if (!isPlainObject(value)) {
    return typeof value === 'string' && /^https?:\/\//i.test(value)
  }
  return Object.entries(value).some(
    ([key, nested]) => CANDIDATE_DATA_KEY.test(key) || containsCandidateData(nested),
  )
}

export function assertNoGoQualityReport(matrix, report, options = {}) {
  inspectRightsMatrix(matrix, options)
  const verdict = evaluateRights(matrix, options)
  requireCondition(
    verdict.status === 'RIGHTS_NO_GO' && verdict.search_authorized === false,
    'quality report requires an authorization-ineligible no-go matrix',
  )
  requireCondition(!containsCandidateData(report), 'quality report contains candidate-like data')
  requireExactKeys(report, QUALITY_KEYS, 'quality report')
  requireCondition(report.schema_version === 1, 'quality schema_version must equal 1')
  requireCondition(report.phase === '05', 'quality phase must equal 05')
  requireCondition(report.status === 'NOT_RUN_RIGHTS_NO_GO',
    'quality status must be NOT_RUN_RIGHTS_NO_GO')
  requireCondition(report.rights_status === 'RIGHTS_NO_GO',
    'rights status must be RIGHTS_NO_GO')
  requireCondition(report.search_authorized === false, 'search must remain unauthorized')
  requireCondition(
    report.rights_evidence_sha256 === matrix.rights_evidence_sha256,
    'quality report rights digest mismatch',
  )
  requireCondition(Array.isArray(report.cases) && report.cases.length === 0,
    'no-run report cases must be empty')
  for (const key of [
    'provider_call_count',
    'fixture_count',
    'raw_result_count',
    'production_mutation_count',
  ]) {
    requireCondition(report[key] === 0, `${key} must equal zero`)
  }
  requireCondition(
    typeof report.quality_evidence_sha256 === 'string'
      && SHA256.test(report.quality_evidence_sha256),
    'quality_evidence_sha256 is malformed',
  )
  const { quality_evidence_sha256, ...reportBody } = report
  requireCondition(
    quality_evidence_sha256 === sha256Json(reportBody),
    'quality evidence digest mismatch',
  )
  return report
}

function parseArgs(argv) {
  const parsed = {
    assertNoGo: false,
    matrixPath: null,
    qualityReportPath: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--assert-no-go') {
      requireCondition(!parsed.assertNoGo, 'duplicate --assert-no-go')
      parsed.assertNoGo = true
    } else if (argument === '--matrix' || argument === '--quality-report') {
      const value = argv[++index]
      requireCondition(value && !value.startsWith('--'), `${argument} requires a path`)
      const key = argument === '--matrix' ? 'matrixPath' : 'qualityReportPath'
      requireCondition(parsed[key] === null, `duplicate ${argument}`)
      parsed[key] = value
    } else {
      throw new Error(`unknown argument: ${argument}`)
    }
  }
  requireCondition(parsed.assertNoGo, '--assert-no-go is required')
  requireCondition(parsed.matrixPath !== null, '--matrix is required')
  requireCondition(parsed.qualityReportPath !== null, '--quality-report is required')
  return parsed
}

async function main(argv) {
  const args = parseArgs(argv)
  const matrix = JSON.parse(await readFile(resolve(args.matrixPath), 'utf8'))
  const report = JSON.parse(await readFile(resolve(args.qualityReportPath), 'utf8'))
  const verdict = evaluateRights(matrix)
  requireCondition(
    verdict.status === 'RIGHTS_NO_GO' && verdict.search_authorized === false,
    'matrix does not produce RIGHTS_NO_GO',
  )
  assertNoGoQualityReport(matrix, report)
  process.stdout.write(`${JSON.stringify({
    rights_status: verdict.status,
    quality_status: report.status,
    search_authorized: verdict.search_authorized,
    provider_call_count: report.provider_call_count,
    fixture_count: report.fixture_count,
    raw_result_count: report.raw_result_count,
    production_mutation_count: report.production_mutation_count,
  }, null, 2)}\n`)
}

const isMainModule = process.argv[1]
  && fileURLToPath(import.meta.url)
    === fileURLToPath(pathToFileURL(resolve(process.argv[1])))

if (isMainModule) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'rights gate failed'}\n`)
    process.exitCode = 1
  })
}

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const webRoot = join(repoRoot, 'web')
const vitestBin = join(webRoot, 'node_modules', 'vitest', 'vitest.mjs')

const BASELINE_NAMES = [
  'notification removal migration > stops delivery work and removes notification persistence',
  'notification removal migration > removes alert tuning fields and leaves account deletion feed-only',
  'cheapFilter — exclude keywords (D-02, word boundary) > hard-discards on a whole-word exclude hit in the title',
  'cheapFilter — exclude keywords (D-02, word boundary) > does not false-positive a single-letter exclude inside a longer token',
  'cheapFilter — exclude keywords (D-02, word boundary) > does not false-positive "go" inside "category"',
  'cheapFilter — exclude keywords (D-02, word boundary) > does not false-positive "staff" inside "staffing"',
  'cheapFilter — exclude keywords (D-02, word boundary) > discards on a whole-word "go" hit',
  'cheapFilter — exclude keywords (D-02, word boundary) > discards on a contiguous multi-word exclude phrase in the JD',
  'cheapFilter — include keywords never discard (D-02) > passes even when an include keyword is absent from the JD',
  'cheapFilter — include keywords never discard (D-02) > reports matched include keywords on pass without discarding',
  'cheapFilter — title overlap (D-01) > matches through a known synonym pair',
  'cheapFilter — title overlap (D-01) > discards on clear title non-overlap',
  'cheapFilter — title overlap (D-01) > passes the title check when prefs.titles is empty',
  'cheapFilter — location leniency (D-03) > passes when the job location contains a preferred location',
  'cheapFilter — location leniency (D-03) > passes a remote posting regardless of preferred locations',
  'cheapFilter — location leniency (D-03) > passes when the job location is blank/null (AI judges later)',
  'cheapFilter — location leniency (D-03) > discards a clear location mismatch with no remote mention',
  'cheapFilter — check order (D-04) > reports excluded_keyword before wrong_location when both apply',
  'SYNONYMS table (D-01) > seeds the named synonym pairs',
]

const SUITES = {
  backend: {
    files: [
      'tests/filters.test.ts',
      'tests/scoring-input.test.ts',
      'tests/company-name-ingestion.test.ts',
      'tests/notification-removal.test.ts',
    ],
    newNames: [
      'cheapFilter — exclusive multi-concept title intent > rejects Equity Research shared-token data and science roles',
      'cheapFilter — exclusive multi-concept title intent > accepts reordered plural inflected and suffixed Equity Research variants',
      'cheapFilter — exclusive multi-concept title intent > accepts conservative general inflections and configured synonym concepts',
      'cheapFilter — exclusive multi-concept title intent > uses one provider-agnostic post-dedup filter path for named fixtures',
      'semantic scoring input freshness > loads an explicit scoring-input module instead of treating its absence as infrastructure failure',
      'semantic scoring input freshness > hashes every semantic preference job extraction routing model prompt filter and version input',
      'semantic scoring input freshness > canonicalizes order and case semantic no-ops while equality alone permits reuse',
      'migration 0025 scoring freshness contract > advances all applicable open rows and resets retry claim and error state',
      'migration 0025 scoring freshness contract > captures claimed revision and requires id plus revision CAS on every terminal worker write',
      'migration 0025 scoring freshness contract > enforces a short-lived service-only exactly-two-fixture maintenance latch',
      'migration 0025 scoring freshness contract > models late signals no-id mismatch exact concurrent end and expiry claim boundaries',
      'migration 0025 scoring freshness contract > keeps pipeline fields service-owned and notification runtime absent',
      'score-tick isolation and survivor ordering contract > validates a strict verification UUID after method and cron auth before claim',
      'score-tick isolation and survivor ordering contract > has no provider source bypass and reaches routing hashing and AI only after cheapFilter passes',
      'truthful company-name ingestion > normalizes Adzuna provider names but leaves missing names null',
      'truthful company-name ingestion > persists bounded Adzuna source company names on insert and exact refresh',
      'truthful company-name ingestion > backfills joined names and retains tracked Greenhouse Ashby company identity',
    ],
    expectedFailures: [
      'cheapFilter — exclusive multi-concept title intent > rejects Equity Research shared-token data and science roles',
      'semantic scoring input freshness > loads an explicit scoring-input module instead of treating its absence as infrastructure failure',
      'semantic scoring input freshness > hashes every semantic preference job extraction routing model prompt filter and version input',
      'semantic scoring input freshness > canonicalizes order and case semantic no-ops while equality alone permits reuse',
      'migration 0025 scoring freshness contract > advances all applicable open rows and resets retry claim and error state',
      'migration 0025 scoring freshness contract > captures claimed revision and requires id plus revision CAS on every terminal worker write',
      'migration 0025 scoring freshness contract > enforces a short-lived service-only exactly-two-fixture maintenance latch',
      'migration 0025 scoring freshness contract > models late signals no-id mismatch exact concurrent end and expiry claim boundaries',
      'migration 0025 scoring freshness contract > keeps pipeline fields service-owned and notification runtime absent',
      'score-tick isolation and survivor ordering contract > validates a strict verification UUID after method and cron auth before claim',
      'score-tick isolation and survivor ordering contract > has no provider source bypass and reaches routing hashing and AI only after cheapFilter passes',
      'truthful company-name ingestion > normalizes Adzuna provider names but leaves missing names null',
      'truthful company-name ingestion > persists bounded Adzuna source company names on insert and exact refresh',
      'truthful company-name ingestion > backfills joined names and retains tracked Greenhouse Ashby company identity',
    ],
  },
  'web-gap': {
    files: [
      'src/lib/feed.test.ts',
      'src/lib/preferences.test.ts',
      'src/pages/Preferences.test.tsx',
      'tests/preference-refilter-feed.integration.test.ts',
      'tests/company-name-feed.integration.test.ts',
    ],
    newNames: [
      'focused feed freshness gap > hides every noncurrent closed weak dismissed or needs-refilter row',
      'preference save cache gap > cancels removes and invalidates feed only after signal success',
      'preference refilter feed gap > hides stale shared-token roles and converges on fresh matches',
      'truthful company feed gap > maps Adzuna Greenhouse and Ashby names without fabrication',
    ],
    expectedFailures: [
      'focused feed freshness gap > hides every noncurrent closed weak dismissed or needs-refilter row',
      'preference save cache gap > cancels removes and invalidates feed only after signal success',
      'preference refilter feed gap > hides stale shared-token roles and converges on fresh matches',
      'truthful company feed gap > maps Adzuna Greenhouse and Ashby names without fabrication',
    ],
  },
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function exactNamePattern(names) {
  return `^(?:${names.map((name) => escapeRegex(name.replaceAll(' > ', ' '))).join('|')})$`
}

function runVitest(files, names, outputFile) {
  return spawnSync(
    process.execPath,
    [
      vitestBin,
      'run',
      ...files,
      '--testNamePattern',
      exactNamePattern(names),
      '--reporter=json',
      `--outputFile=${outputFile}`,
    ],
    { cwd: webRoot, encoding: 'utf8', timeout: 60_000 },
  )
}

function parseReport(path, label) {
  let report
  try {
    report = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${label}: missing or invalid Vitest JSON (${error.message})`)
  }
  const assertions = (report.testResults ?? [])
    .flatMap((file) => file.assertionResults ?? [])
    .filter((assertion) => assertion.status !== 'skipped')
  if (assertions.length === 0) throw new Error(`${label}: zero collected assertions`)
  return { report, assertions }
}

function fullName(assertion) {
  return [...(assertion.ancestorTitles ?? []), assertion.title].join(' > ')
}

function rejectInfrastructureFailure(result, label) {
  if (result.error) throw new Error(`${label}: Vitest crashed: ${result.error.message}`)
  if (result.signal) throw new Error(`${label}: Vitest terminated by ${result.signal}`)
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (/timed out|timeout|failed to (load|resolve)|transform|syntaxerror|unhandled error|no test files found/i.test(output)) {
    throw new Error(`${label}: infrastructure failure\n${output}`)
  }
}

function requireExactNames(assertions, expected, label) {
  const actual = assertions.map(fullName).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label}: test inventory mismatch\nexpected=${wanted.join('\n')}\nactual=${actual.join('\n')}`)
  }
}

const suiteFlag = process.argv.indexOf('--suite')
const suiteName = suiteFlag >= 0 ? process.argv[suiteFlag + 1] : 'backend'
const suite = SUITES[suiteName]
if (!suite) throw new Error(`unknown suite: ${suiteName}`)

const temporary = mkdtempSync(join(tmpdir(), 'job-copilot-red-'))
try {
  const baselineJson = join(temporary, 'baseline.json')
  const baseline = runVitest(
    ['tests/filters.test.ts', 'tests/notification-removal.test.ts'],
    BASELINE_NAMES,
    baselineJson,
  )
  rejectInfrastructureFailure(baseline, 'baseline')
  if (baseline.status !== 0) {
    throw new Error(`baseline must remain green\n${baseline.stdout}\n${baseline.stderr}`)
  }
  const baselineReport = parseReport(baselineJson, 'baseline')
  requireExactNames(baselineReport.assertions, BASELINE_NAMES, 'baseline')
  if (baselineReport.assertions.some((test) => test.status !== 'passed')) {
    throw new Error('baseline contains a non-passing assertion')
  }

  const expectedJson = join(temporary, `${suiteName}.json`)
  const expected = runVitest(suite.files, suite.newNames, expectedJson)
  rejectInfrastructureFailure(expected, suiteName)
  if (expected.status === 0) throw new Error(`${suiteName}: expected RED run exited zero`)
  const expectedReport = parseReport(expectedJson, suiteName)
  requireExactNames(expectedReport.assertions, suite.newNames, suiteName)
  const expectedFailureSet = new Set(suite.expectedFailures)
  const actualFailures = expectedReport.assertions
    .filter((test) => test.status === 'failed')
    .map(fullName)
    .sort()
  const wantedFailures = [...expectedFailureSet].sort()
  if (JSON.stringify(actualFailures) !== JSON.stringify(wantedFailures)) {
    throw new Error(`${suiteName}: failure allowlist mismatch`)
  }
  if (expectedReport.assertions.some((test) => !['passed', 'failed'].includes(test.status))) {
    throw new Error(`${suiteName}: selected assertion was neither a pass nor an intended failure`)
  }

  const failureText = expectedReport.assertions
    .flatMap((test) => test.failureMessages ?? [])
    .join('\n')
  if (/failed to (load|resolve)|transform|syntaxerror|no test files found|unhandled error/i.test(failureText)) {
    throw new Error(`${suiteName}: failure was infrastructure, not an assertion`)
  }
  if (suite.expectedFailures.length === 0) throw new Error(`${suiteName}: zero expected failures`)

  console.log(`expected RED verified: ${suiteName} (${suite.expectedFailures.length} intended failures); baseline ${BASELINE_NAMES.length} green`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}

# Phase 5: Outreach Feasibility Gate - Pattern Map

**Mapped:** 2026-07-28
**Files analyzed:** 15 current or explicitly conditional files
**Analogs found:** 15 / 15
**Current gate:** `RIGHTS_NO_GO`

## Scope Resolution

The current implementation path is evidence-only. It must produce a
deterministic rights no-go, a quality report with
`NOT_RUN_RIGHTS_NO_GO`, exact owner decision evidence, zero provider calls,
and zero third-party residue. It must not create real-application fixtures,
read a Tavily key, call Tavily, or modify production UI, schema, Edge
Functions, search behavior, or user data.

The research also names a dormant quality-spike directory. Those files are
classified below so a later planner has concrete analogs, but
`quality-evaluator.mjs`, its test, and `sanitize-report.mjs` are conditional
files, not current no-go work. If the planner keeps a dormant
`spike-runner.mjs` scaffold in the current plan, it must be library-only and
prove that no provider boundary is reachable unless every required permission
row is explicitly `ALLOW` and the approval is bound to the exact evidence
digest.

No fixture, raw-result, cache, production migration, production function, or
web file belongs in Phase 5's current file set.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `scripts/outreach-feasibility/rights-gate.mjs` | utility | transform | `scripts/verify-phase-03-9-hosted.mjs` | exact role/data-flow |
| `scripts/outreach-feasibility/rights-gate.test.mjs` | test | transform | `scripts/verify-phase-03-9-hosted.test.mjs` | exact role/data-flow |
| `scripts/outreach-feasibility/decision-evidence.mjs` | utility | transform + file-I/O | `scripts/verify-phase-03-9-hosted.mjs` | exact role/data-flow |
| `scripts/outreach-feasibility/decision-evidence.test.mjs` | test | transform | `scripts/verify-phase-03-9-hosted.test.mjs` | exact role/data-flow |
| `scripts/outreach-feasibility/residue-check.mjs` | utility | file-I/O + batch | `scripts/verify-expected-red.mjs` | role/data-flow match |
| `scripts/outreach-feasibility/residue-check.test.mjs` | test | file-I/O + batch | `scripts/run-phase-03-9-rollout.test.mjs` | role/data-flow match |
| `scripts/outreach-feasibility/dormant/spike-runner.mjs` | service | request-response | `supabase/functions/_shared/connectors.ts` | role/data-flow match |
| `scripts/outreach-feasibility/dormant/spike-runner.test.mjs` | test | request-response | `web/tests/branded-connectors.integration.test.ts` | exact safety invariant |
| `scripts/outreach-feasibility/dormant/quality-evaluator.mjs` | utility | transform | `supabase/functions/_shared/discovery-health.ts` | role/data-flow match; conditional |
| `scripts/outreach-feasibility/dormant/quality-evaluator.test.mjs` | test | transform | `scripts/verify-phase-03-9-hosted.test.mjs` | role-match; conditional |
| `scripts/outreach-feasibility/dormant/sanitize-report.mjs` | utility | transform | `scripts/verify-scoring-evidence.mjs` | partial; conditional |
| `.planning/phases/05-outreach-feasibility-gate/05-RIGHTS-MATRIX.json` | config | transform | `scripts/verify-scoring-evidence.mjs` | exact evidence-contract pattern |
| `.planning/phases/05-outreach-feasibility-gate/05-QUALITY-REPORT.json` | config | batch | `scripts/verify-phase-03-9-hosted.mjs` | exact machine-readable-check pattern |
| `.planning/phases/05-outreach-feasibility-gate/05-DECISION.json` | config | transform | `scripts/verify-phase-03-9-hosted.mjs` | exact owner-evidence pattern |
| `.planning/phases/05-outreach-feasibility-gate/05-ZERO-RESIDUE.json` | config | file-I/O + batch | `scripts/run-phase-03-9-rollout.mjs` | exact zero-count pattern |

## Pattern Assignments

### `scripts/outreach-feasibility/rights-gate.mjs` (utility, transform)

**Primary analog:** `scripts/verify-phase-03-9-hosted.mjs`

**Imports pattern** (lines 3-10):

```javascript
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  DEFAULT_MANIFEST,
  RELEASE_MANIFEST_ID,
  validateManifest,
} from './run-phase-03-9-rollout.mjs'
```

Copy the ESM convention: `node:` built-ins, single quotes, no external
dependency, and pure exports that can be imported by `node:test`.

**Fail-closed evaluator pattern** (lines 15-51):

```javascript
export function evaluateHostedSnapshot(manifest, snapshot) {
  const checks = {
    migration_0045: snapshot.remote_migrations?.includes('0045') === true,
    repair_migrations: ['0046', '0047'].every(
      (version) => snapshot.remote_migrations?.includes(version) === true,
    ),
    function_parity: ['observe-connectors', 'poll-tick'].every(
      (slug) => snapshot.functions?.[slug]?.status === 'ACTIVE'
        && snapshot.functions[slug].verify_jwt === manifest.functions[slug].verify_jwt,
    ),
    zero_residue: Number(snapshot.verifier_residue_count) === 0,
  }
  const status = Object.values(checks).every(Boolean)
    ? 'PASS'
    : snapshot.company?.activation_state === 'unsupported'
      ? 'UNSUPPORTED'
      : 'PENDING'
  return {
    schema_version: 1,
    phase: '03.9',
    release_manifest_id: RELEASE_MANIFEST_ID,
    status,
    checks: Object.fromEntries(Object.entries(checks).map(
      ([key, passed]) => [key, { status: passed ? 'PASS' : 'PENDING' }],
    )),
  }
}
```

For Phase 5, replace the hosted checks with one exact row per required
operation:

- `public_search`
- `transient_owner_review`
- `persist_profile_url`
- `persist_title_reason`
- `manual_networking_purpose`
- `provider_retention`

Every required row must exist exactly once, be current, carry its normalized
evidence digest, and have status `ALLOW`. Missing, duplicate, stale,
hash-mismatched, `PROHIBIT`, `AMBIGUOUS`, or any unknown status returns:

```text
status: RIGHTS_NO_GO
search_authorized: false
quality_status: NOT_RUN_RIGHTS_NO_GO
provider_call_count: 0
fixture_count: 0
raw_result_count: 0
production_mutation_count: 0
```

The current matrix must evaluate to `RIGHTS_NO_GO`. Do not provide an
owner-override branch: owner acknowledgement records the no-go but cannot
convert a prohibited or ambiguous row to `ALLOW`.

**Exact-schema validation pattern:** `scripts/verify-scoring-evidence.mjs`
lines 90-105:

```javascript
function requireSchema(fields, schema) {
  const allowed = new Set(Object.keys(schema))
  for (const key of Object.keys(fields)) {
    if (!allowed.has(key)) throw new Error(`unknown field: ${key}`)
  }

  for (const [key, expected] of Object.entries(schema)) {
    if (!Object.hasOwn(fields, key)) throw new Error(`missing field: ${key}`)
    const value = fields[key]
    if (typeof expected === 'string') {
      if (value !== expected) throw new Error(`${key} must equal ${expected}`)
    } else if (!expected.test(value)) {
      throw new Error(`${key} is malformed`)
    }
  }
}
```

Use exact key allowlists for the top-level matrix and every operation row.
Technical API capability must never upgrade a rights status.

---

### `scripts/outreach-feasibility/rights-gate.test.mjs` (test, transform)

**Analog:** `scripts/verify-phase-03-9-hosted.test.mjs`

**Test imports** (lines 1-8):

```javascript
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertHostedRecord,
  assertUatRecord,
  evaluateHostedSnapshot,
  exactUatApproval,
} from './verify-phase-03-9-hosted.mjs'
```

**One-field-negative pattern** (lines 52-60):

```javascript
test('reports PENDING for incomplete activation or cleanup', () => {
  const snapshot = passingSnapshot()
  snapshot.company.activation_successes = 2
  snapshot.verifier_residue_count = 1
  const result = evaluateHostedSnapshot(manifest, snapshot)
  assert.equal(result.status, 'PENDING')
  assert.equal(result.checks.activation.status, 'PENDING')
  assert.equal(result.checks.zero_residue.status, 'PENDING')
})
```

Start with one synthetic all-`ALLOW` matrix, mutate one field per test, and
prove each missing, prohibited, ambiguous, stale, duplicate, extra-key, and
digest-drift case becomes `RIGHTS_NO_GO`. Separately load the real committed
matrix and assert it is no-go with all four effect counters at zero.

---

### `scripts/outreach-feasibility/decision-evidence.mjs` (utility, transform + file-I/O)

**Primary analog:** `scripts/verify-phase-03-9-hosted.mjs`

**Canonical digest pattern** (lines 54-66):

```javascript
function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonical(value[key])}`,
    ).join(',')}}`
  }
  return JSON.stringify(value)
}
```

Hash canonical JSON with a final newline. Bind the owner decision to the
aggregate rights-evidence digest and the no-go quality/residue evidence, not
to a mutable filename alone.

**Exact owner-decision pattern** (lines 107-147):

```javascript
export function exactUatApproval(manifest, record) {
  const payloadHash = sha256(canonical(uatApprovalPayload(manifest, record)))
  return [
    'approve Phase 03.9 JPMorgan UAT',
    manifest.release_manifest_id,
    payloadHash,
  ].join(' ')
}

export function assertUatRecord(manifest, record) {
  const requiredApproval = exactUatApproval(manifest, record)
  requireCondition(record.required_approval === requiredApproval,
    'UAT approval payload drift')
  if (record.status === 'PASS') {
    requireCondition(record.owner_attestation === requiredApproval,
      'UAT PASS requires the literal owner approval')
  } else {
    requireCondition(record.status === 'PENDING_OWNER_BROWSER',
      'UAT has an invalid non-PASS state')
    requireCondition(record.owner_attestation == null,
      'pending UAT cannot contain an owner attestation')
  }
  return { status: record.status, required_approval: requiredApproval }
}
```

Derive and require this Phase 5 literal, substituting only the computed digest:

```text
I ACCEPT PHASE 5 RIGHTS NO-GO <rights_evidence_sha256>; production outreach search remains disabled; the outreach milestone stops pending a separately scoped owner decision.
```

Reject case or punctuation drift, a missing/stale digest, any `GO` value, a
claim that quality ran, or any nonzero provider/fixture/raw/production count.
Before exact owner input, emit `PENDING_OWNER_ATTESTATION`; after it, record
`RIGHTS_NO_GO_ACCEPTED`. Neither state authorizes search.

**CLI/error pattern** (lines 174-208):

```javascript
async function main() {
  const args = parseArgs(process.argv.slice(2))
  // Read, validate, and print only machine-readable evidence.
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
```

Keep stdout sanitized JSON and stderr to bounded error messages without policy
text, secrets, raw responses, URLs, or candidate data.

---

### `scripts/outreach-feasibility/decision-evidence.test.mjs` (test, transform)

**Analog:** `scripts/verify-phase-03-9-hosted.test.mjs` lines 121-130:

```javascript
test('rejects a fabricated UAT PASS without the literal owner signal', () => {
  const { finalManifest, record } = pendingUat()
  record.status = 'PASS'
  assert.throws(
    () => assertUatRecord(finalManifest, record),
    /literal owner approval/,
  )
  record.owner_attestation = record.required_approval
  assert.equal(assertUatRecord(finalManifest, record).status, 'PASS')
})
```

Copy the pending-then-exact-attestation structure. Add negative cases for one
character of digest drift, punctuation/case drift, `GO`, nonzero counts,
`quality_status: PASS`, and a residue record that is not `PASS`.

---

### `scripts/outreach-feasibility/residue-check.mjs` (utility, file-I/O + batch)

**Primary analog:** `scripts/verify-expected-red.mjs`

**Built-in filesystem imports** (lines 1-5):

```javascript
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
```

Use async `node:fs/promises` in the new script, but keep the same explicit
root resolution. Never recursively scan or delete `$HOME`, `~`, `/`, or the
workspace root.

**Guaranteed cleanup pattern for test-owned temporary data** (lines 164-212):

```javascript
const temporary = mkdtempSync(join(tmpdir(), 'job-copilot-red-'))
try {
  // Produce and inspect only verifier-owned temporary files.
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
```

The current no-go checker must assert that no outreach corpus/raw root was ever
created; it should not create such a root itself. The pattern above is for
unit-test fixtures and for a future authorized spike only.

**Zero-count evidence pattern:** `scripts/run-phase-03-9-rollout.mjs`
lines 360-366:

```javascript
requireCondition(
  evidence.cleanup?.status === 'PASS'
    && evidence.cleanup.temporary_fixture_count === 0
    && evidence.cleanup.verifier_residue_count === 0
    && evidence.cleanup.scheduler_override_count === 0,
  'cleanup evidence failed',
)
```

Scan only explicit allowlisted locations. Assert:

- provider calls, fixtures, raw results, and production mutations are all zero;
- no fixture/raw/cache directory or Tavily response file exists;
- committed Phase 5 JSON contains no names, candidate URLs,
  `linkedin.com/in/`, snippets, raw titles, queries, role facts, provider
  payloads, or secret-like keys;
- only the rights matrix, no-run quality report, decision record, and residue
  record survive.

The output must distinguish local/Git zero residue from provider-side
retention; it must not claim anything about Tavily infrastructure.

---

### `scripts/outreach-feasibility/residue-check.test.mjs` (test, file-I/O + batch)

**Analog:** `scripts/run-phase-03-9-rollout.test.mjs`

**Residue-tamper rejection** (lines 166-179):

```javascript
test('historical manifest chain and final rollout evidence assert read-only', async () => {
  const manifests = await manifestChain()
  const evidence = JSON.parse(await readFile(
    '.planning/phases/03.9-jpmorgan-chase-selective-oracle-monitoring/03.9-01-ROLLOUT-VERIFICATION.json',
  ))
  assert.equal(assertRolloutEvidence(evidence, manifests).status, 'PASS')

  const drifted = structuredClone(evidence)
  drifted.cleanup.verifier_residue_count = 1
  assert.throws(
    () => assertRolloutEvidence(drifted, manifests),
    /cleanup evidence failed/,
  )
})
```

Create every test artifact under a unique test-owned temp directory and remove
it in `finally`. Test nested forbidden keys and URL values, a symlink, a
nonzero count, an unexpected surviving file, and the clean no-go case.

---

### `scripts/outreach-feasibility/dormant/spike-runner.mjs` (service, request-response)

**Primary analog:** `supabase/functions/_shared/connectors.ts`

**Injected effect plus fail-before-fetch pattern** (lines 449-477):

```typescript
export async function observeConnector(
  company: PollConnectorCompany,
  fetchImpl: FetchLike = fetch,
): Promise<PollObservation> {
  if (company.activation_state !== 'experimental') {
    throw new Error(`inactive_observation_connector:${company.activation_state}`)
  }
  if (company.ats_type === 'workday') {
    const identity = workdayIdentityForCompany(company)
    if (!identity) {
      throw new Error('inactive_observation_connector:identity_not_allowed')
    }
    return providerRegistry.workday.poll(company, new Set(), fetchImpl)
  }
  const identity = brandedIdentityForCompany(company)
  if (!identity) {
    throw new Error('inactive_observation_connector:identity_not_allowed')
  }
  return providerRegistry[identity.provider].poll(company, new Set(), fetchImpl)
}
```

For Phase 5, `evaluateRights()` must run before reading
`TAVILY_API_KEY`, building a query/request, creating a temp corpus, incrementing
a call counter, or invoking `fetchImpl`. The current committed matrix must
return the no-run record without touching any of those dependencies.

Keep this module unreferenced by a current CLI/package script. If a dormant
scaffold is created now, expose only injected functions so tests can prove the
boundary with fake evidence and a fake fetch.

**Physical-attempt admission pattern:** `supabase/functions/discovery-sweep/index.ts`
lines 170-198:

```typescript
for (const seed of seeds) {
  const reservation = await reserveAdzunaRequest(admin)
  requestCount = reservation.requests_today
  if (!reservation.reserved) {
    budgetExhausted = true
    break
  }

  attempted += 1
  try {
    const response = await fetch(
      buildAdzunaUrl('us', seed.what, seed.where_loc, appId, appKey),
    )
    if (!response.ok) throw new Error(`Adzuna HTTP ${response.status}`)
    succeeded += 1
  } catch (error) {
    failedQueries += 1
    continue
  }
}
```

Use this only if applicable written permission later reopens the spike. Count
every physical attempt before fetch, including the one bounded retry; never
exceed three physical calls per case. A persistent provider/evidence failure
becomes `coverage_unknown`, not `no_match`.

---

### `scripts/outreach-feasibility/dormant/spike-runner.test.mjs` (test, request-response)

**Primary analog:** `web/tests/branded-connectors.integration.test.ts`
lines 134-163:

```typescript
const noFetch = vi.fn()

await expect(observeConnector(active, noFetch)).rejects.toThrow(
  'inactive_observation_connector:active',
)
await expect(observeConnector(disabled, noFetch)).rejects.toThrow(
  'inactive_observation_connector:disabled',
)
expect(noFetch).not.toHaveBeenCalled()
```

The local `.mjs` test should use `node:test` and an integer/injected spy rather
than Vitest, following `scripts/run-phase-03-9-rollout.test.mjs` lines 48-58:

```javascript
let calls = 0
await assert.rejects(
  executeRelease(manifest, 'approve something else', hashes, async () => {
    calls += 1
  }),
  /exact manifest\/hash-bound approval/,
)
assert.equal(calls, 0)
```

Test every non-`ALLOW` status, missing/stale evidence, digest drift, and the real
matrix with `calls === 0`. A synthetic all-`ALLOW` unit test may reach a mock
fetch, but no test may use the network or an API key.

---

### Conditional dormant quality files

These files are classified from `05-RESEARCH.md` but should not be scheduled
for the current rights no-go unless needed solely to compile-test an inert
scaffold.

#### `scripts/outreach-feasibility/dormant/quality-evaluator.mjs`

**Analog:** `supabase/functions/_shared/discovery-health.ts` lines 144-158:

```typescript
export function summarizeDiscovery(
  attempted: number,
  succeeded: number,
  skipped = 0,
): DiscoveryHealth {
  if (attempted > 0 && succeeded === 0) {
    return { status: 'failed', httpStatus: 503 }
  }

  if (succeeded < attempted || skipped > 0) {
    return { status: 'degraded', httpStatus: 200 }
  }

  return { status: 'ok', httpStatus: 200 }
}
```

Copy the explicit separation of success, partial/unknown work, and failure.
Phase 5's eventual pure evaluator must preserve
`pass | no_match | coverage_unknown`, require four of six real cases, require
the positive control, and require rejection of the negative control. The
current report bypasses this evaluator and says `NOT_RUN_RIGHTS_NO_GO`.

#### `scripts/outreach-feasibility/dormant/quality-evaluator.test.mjs`

**Analog:** the passing-fixture-plus-one-field-negative structure in
`scripts/verify-phase-03-9-hosted.test.mjs` lines 20-67. Test the threshold,
both controls, and ensure `coverage_unknown` never counts as a pass or silently
becomes `no_match`.

#### `scripts/outreach-feasibility/dormant/sanitize-report.mjs`

**Analog:** `scripts/verify-scoring-evidence.mjs` lines 90-105. Use a finite
output allowlist, then recursively reject forbidden keys and candidate-like
values at any depth. Do not log rejected values. There is no exact
candidate-data sanitizer analog in the repository, so use the recursive
redaction contract in `05-RESEARCH.md` for the Phase-specific portion.

---

### `.planning/phases/05-outreach-feasibility-gate/05-RIGHTS-MATRIX.json` (config, transform)

**Analog:** the exact field schemas in
`scripts/verify-scoring-evidence.mjs` lines 10-72 and validation at lines
90-105.

Use a versioned finite schema. Each sanitized row should contain only:

- source URL and source date marker;
- retrieval timestamp;
- clause identifier;
- reviewed operation;
- `ALLOW | PROHIBIT | AMBIGUOUS | NOT_APPLICABLE`;
- short paraphrase;
- normalized clause-evidence SHA-256;
- whether the operation is required.

Also store the canonical aggregate digest. Do not store complete policy HTML,
long quotations, candidate data, or provider output. The current matrix must
retain the prohibitions/ambiguities that produce `RIGHTS_NO_GO`.

---

### `.planning/phases/05-outreach-feasibility-gate/05-QUALITY-REPORT.json` (config, batch)

**Analog:** machine-readable result/check assembly in
`scripts/verify-phase-03-9-hosted.mjs` lines 15-51.

The current artifact is a truthful no-run report, not an empty failed search:

```text
status: NOT_RUN_RIGHTS_NO_GO
rights_status: RIGHTS_NO_GO
cases: []
provider_call_count: 0
fixture_count: 0
raw_result_count: 0
production_mutation_count: 0
```

Bind it to the rights-evidence digest. It must contain no fabricated
`pass`, `no_match`, or `coverage_unknown` case outcomes and no candidate,
company, application, URL, title, snippet, or query data.

---

### `.planning/phases/05-outreach-feasibility-gate/05-DECISION.json` (config, transform)

**Analog:** `uatApprovalPayload()`, `exactUatApproval()`, and
`assertUatRecord()` in `scripts/verify-phase-03-9-hosted.mjs` lines 92-147.

Record exact schema/version/phase, `RIGHTS_NO_GO`,
`NOT_RUN_RIGHTS_NO_GO`, `search_authorized: false`, all four zero counters,
production outreach disabled, the stopped milestone state, evidence digests,
the required literal, and either pending or exact owner attestation. Reject
unknown fields so a later edit cannot quietly add an authorization.

---

### `.planning/phases/05-outreach-feasibility-gate/05-ZERO-RESIDUE.json` (config, file-I/O + batch)

**Analog:** cleanup assertion in `scripts/run-phase-03-9-rollout.mjs`
lines 360-366.

Persist only the check inventory, allowlisted scan roots, zero counts,
forbidden-hit count, timestamp, and `PASS`. Bind it to the rights, quality, and
decision digests. It proves controlled local/Git surfaces are clean; it must
not claim provider-side zero data retention.

## Shared Patterns

### Fail Closed Before Side Effects

**Sources:** `scripts/run-phase-03-9-rollout.mjs` lines 407-415 and
`supabase/functions/_shared/connectors.ts` lines 449-477

Apply to the rights gate, decision verifier, and dormant runner. Validation and
exact evidence binding precede the first injected effect. The real Phase 5
matrix must produce zero calls.

### Exact Evidence and Owner Binding

**Sources:** `scripts/verify-phase-03-9-hosted.mjs` lines 54-66 and 92-147

Canonicalize before hashing, derive the required literal from the canonical
payload, and compare the literal exactly. A SHA-256 binds evidence identity; it
does not authenticate the owner or turn no-go evidence into permission.

### Exact Schemas

**Source:** `scripts/verify-scoring-evidence.mjs` lines 74-105

Reject malformed, duplicate, missing, and unknown fields. Do not silently
default a missing permission, count, digest, or status.

### Zero-Call Proof

**Sources:** `scripts/run-phase-03-9-rollout.test.mjs` lines 48-58 and
`web/tests/branded-connectors.integration.test.ts` lines 134-163

Inject the effect function, trigger every denial path, and assert the spy was
never called. A report field alone is insufficient proof.

### Temporary Data and Cleanup

**Source:** `scripts/verify-expected-red.mjs` lines 164-212

Future authorized transient data belongs beneath one unique OS temp root and
is removed in `finally`. The current path instead proves that the root was
never created. Recursive removal is allowed only for a validated,
verifier-owned temp prefix.

### Honest Outcome Semantics

**Source:** `supabase/functions/_shared/discovery-health.ts` lines 144-158

Keep intentional skip, successful no-match, partial/unknown coverage, and
provider failure distinct. For this run the only accurate quality state is
`NOT_RUN_RIGHTS_NO_GO`.

### Error Handling and Logging

**Source:** `scripts/verify-phase-03-9-hosted.mjs` lines 203-208

Catch only at the CLI boundary, write a bounded message to stderr, and set a
nonzero exit code. Never print API keys, environment objects, policy bodies,
queries, raw provider responses, candidate URLs, names, titles, or snippets.

### Authentication

No production authentication pattern applies. These are local evidence tools,
and Phase 5 must not add browser auth, service-role access, an Edge Function,
or a database authorization model. The owner checkpoint is an exact
evidence-bound attestation, not application authentication.

### Tests

Use repository-standard Node built-ins:

```javascript
import assert from 'node:assert/strict'
import test from 'node:test'
```

Run focused tests with:

```text
node --test scripts/outreach-feasibility/*.test.mjs scripts/outreach-feasibility/dormant/*.test.mjs
```

The dormant glob is applicable only for files actually created. Tests must be
offline and must not require `TAVILY_API_KEY`.

## No Analog Found

No target is wholly unmatched. The recursive candidate-data sanitizer has only
a partial repository analog: copy the exact allowlist behavior from
`scripts/verify-scoring-evidence.mjs`, then apply the Phase-specific recursive
forbidden-key/value contract from `05-RESEARCH.md`.

## Planner Guardrails

- Do not plan production UI, migrations, Edge Functions, caches, search
  endpoints, auth, or user-data changes.
- Do not plan six real-application fixtures, controlled candidate fixtures, or
  raw-result directories while the rights gate is no-go.
- Do not acquire/read a provider key or probe a provider endpoint.
- Do not reinterpret `NOT_RUN_RIGHTS_NO_GO` as quality pass, quality failure,
  `no_match`, or `coverage_unknown`.
- Do not let owner acknowledgement override a prohibited, ambiguous, missing,
  stale, or digest-mismatched permission row.
- Do not auto-select a fallback provider, pasted-URL workflow, or non-LinkedIn
  redesign.
- If dormant code is included, keep it unreferenced, injected, offline-tested,
  and unreachable under the committed matrix.

## Metadata

**Analog search scope:** `scripts/`, `supabase/functions/`, `web/tests/`, and
archived `.planning/milestones/v1.0-phases/` evidence

**Files indexed:** 153 source/test candidates; 531 candidates including
archived evidence

**Strong analog families read:** Phase 03.9 hosted verifier and tests; Phase
03.9 rollout gate and tests; scoring evidence validator and tests; connector /
discovery admission; verifier-owned temporary cleanup

**Pattern extraction date:** 2026-07-28

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import {
  TERMINAL_AUDIT_COMMAND,
  TERMINAL_AUDIT_RUNBOOK,
  assertContractReconciliation,
  buildContractReconciliation,
  extractRequirementsTerminalContract,
  extractRoadmapTerminalContract,
  runContractValidation,
  runTerminalAudit,
} from './terminal-audit.mjs'
import * as terminalAudit from './terminal-audit.mjs'
import {
  PHASE_5_REVIEWED_PATHS,
  assertImmutableZeroResidueV3Lineage,
  assertPublishableZeroResidueRecord,
} from './evidence-integrity.mjs'
import {
  PHASE_5_OFFLINE_TEST_COUNT,
  PHASE_5_OFFLINE_TEST_FILES,
  PHASE_5_VERIFICATION_TRUTHS,
  buildPhase5PassedVerificationEvidence,
  buildZeroResidueRecord,
  migrateZeroResidueV3ToV4,
  normalizePhase5OfflineRunnerResult,
  resolveImmutableAuthenticatedV3Lineage,
  scanOwnedSurfaces as scanOwnedSurfacesProduction,
} from './residue-check.mjs'
import { verifyOwnerAuthorization } from './owner-authorization.mjs'
import {
  buildNoGoQualityReport,
  sha256Json,
} from './rights-gate.mjs'

const execFileAsync = promisify(execFile)
const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const PHASE_RELATIVE =
  '.planning/phases/05-outreach-feasibility-gate'
const DEFAULT_VERIFICATION_SNAPSHOT = Object.freeze({
  source_head_sha: 'a'.repeat(40),
  controlled_tree_sha256: 'b'.repeat(64),
})
const SCRIPT_RELATIVE = 'scripts/outreach-feasibility/terminal-audit.mjs'
const SOURCE_RUNTIME_MODULE_RELATIVES = Object.freeze([
  'scripts/outreach-feasibility/authorization-evidence-validators.mjs',
  'scripts/outreach-feasibility/owner-authorization.mjs',
  'scripts/outreach-feasibility/evidence-integrity.mjs',
  'scripts/outreach-feasibility/residue-check.mjs',
  'scripts/outreach-feasibility/decision-evidence.mjs',
  SCRIPT_RELATIVE,
])
const SUITE_RUNTIME_DEPENDENCY_RELATIVES = Object.freeze([
  'scripts/outreach-feasibility/authorization-evidence-validators.mjs',
  'scripts/outreach-feasibility/decision-evidence.mjs',
  'scripts/outreach-feasibility/dormant/spike-runner.mjs',
  'scripts/outreach-feasibility/evidence-integrity.mjs',
  'scripts/outreach-feasibility/owner-authorization.mjs',
  'scripts/outreach-feasibility/owner-checkpoint.mjs',
  'scripts/outreach-feasibility/residue-check.mjs',
  'scripts/outreach-feasibility/rights-gate.mjs',
  SCRIPT_RELATIVE,
])
const SOURCE_MODULE_RELATIVES = Object.freeze([
  ...SOURCE_RUNTIME_MODULE_RELATIVES,
  ...PHASE_5_OFFLINE_TEST_FILES,
])
const MATRIX_RELATIVE = `${PHASE_RELATIVE}/05-RIGHTS-MATRIX.json`
const QUALITY_RELATIVE = `${PHASE_RELATIVE}/05-QUALITY-REPORT.json`
const DECISION_RELATIVE = `${PHASE_RELATIVE}/05-DECISION.json`
const RECORD_RELATIVE = `${PHASE_RELATIVE}/05-ZERO-RESIDUE.json`
const BASELINE_RELATIVE =
  `${PHASE_RELATIVE}/05-EXECUTION-BASELINE.json`
const REQUEST_RELATIVE =
  `${PHASE_RELATIVE}/05-OWNER-CHECKPOINT-REQUEST.json`
const RECEIPT_RELATIVE =
  `${PHASE_RELATIVE}/05-OWNER-CHECKPOINT.json`
const RECONCILIATION_RELATIVE =
  `${PHASE_RELATIVE}/05-CONTRACT-RECONCILIATION.json`
const AUTHORIZATION_REQUEST_RELATIVE =
  `${PHASE_RELATIVE}/05-OWNER-AUTHORIZATION-REQUEST.json`
const AUTHORIZATION_SIGNATURE_RELATIVE =
  `${AUTHORIZATION_REQUEST_RELATIVE}.sig`
const TRUST_ANCHOR_RELATIVE =
  'scripts/outreach-feasibility/trust/owner-trust-anchor.json'
const PUBLIC_KEY_RELATIVE =
  'scripts/outreach-feasibility/trust/phase-05-owner.pub'
const ALLOWED_SIGNERS_RELATIVE =
  'scripts/outreach-feasibility/trust/phase-05-owner.allowed_signers.txt'
const REVIEW_RELATIVE = `${PHASE_RELATIVE}/05-REVIEW.md`
const VERIFICATION_RELATIVE = `${PHASE_RELATIVE}/05-VERIFICATION.md`
const SUMMARY_09_RELATIVE = `${PHASE_RELATIVE}/05-09-SUMMARY.md`
const SUMMARY_10_RELATIVE = `${PHASE_RELATIVE}/05-10-SUMMARY.md`
const SUMMARY_23_RELATIVE = `${PHASE_RELATIVE}/05-23-SUMMARY.md`
const ROADMAP_RELATIVE = '.planning/ROADMAP.md'
const REQUIREMENTS_RELATIVE = '.planning/REQUIREMENTS.md'
const STATE_RELATIVE = '.planning/STATE.md'
const PRIOR_REVIEW_COMMIT =
  '357d9d02bcc1e4d4bb4b49781f24ae50ff88d1ad'
const PRIOR_REVIEW_SHA256 =
  '8ef26b90728bc388339c07294ffe819d7e8a6d58cd6377a8f11705f14bc8b752'
const EXPECTED_TERMINAL_AUDIT_COMMAND =
  'env -u TAVILY_API_KEY GIT_OPTIONAL_LOCKS=0 node scripts/outreach-feasibility/terminal-audit.mjs --terminal-audit --repo-root . --phase-dir .planning/phases/05-outreach-feasibility-gate'
const EXPECTED_TERMINAL_AUDIT_RUNBOOK = [
  'Phase 5 terminal audit runbook',
  '',
  '1. Run `$gsd-execute-phase 5 --gaps-only` and wait until it fully returns after all standard plan closeout, wave-post gates, code review, verification, `phase.complete`, tracking synchronization, project/todo maintenance, and post hooks.',
  `2. Without making another Phase 5 mutation, run \`${EXPECTED_TERMINAL_AUDIT_COMMAND}\`.`,
  '',
  'The second command is authoritative only after the first command has fully returned. Plan 05-10 tests and SUMMARY are implementation evidence only; no GSD hook invokes this audit. Successful stdout is the final authoritative check. Do not save stdout as a required evidence artifact, and do not make a follow-up commit.',
].join('\n')
const AUTHORIZATION_VERIFIED_AT = new Date('2026-07-31T12:00:00.000Z')
const PHASE_PLAN_IDS = Object.freeze(
  Array.from({ length: 23 }, (_, index) =>
    String(index + 1).padStart(2, '0')),
)

function testRunnerResult(snapshot, overrides = {}) {
  return normalizePhase5OfflineRunnerResult({
    ...snapshot,
    test_file_blobs_sha256: 'c'.repeat(64),
    test_outcomes_sha256: 'd'.repeat(64),
    exit: 0,
    tests: PHASE_5_OFFLINE_TEST_COUNT,
    suites: 0,
    pass: PHASE_5_OFFLINE_TEST_COUNT,
    fail: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
    ...overrides,
  })
}

async function testVerificationRunner(options) {
  return testRunnerResult({
    source_head_sha: options.source_head_sha,
    controlled_tree_sha256: options.controlled_tree_sha256,
  })
}

async function scanOwnedSurfaces(options) {
  return scanOwnedSurfacesProduction({
    ...options,
    verificationRunner: testVerificationRunner,
  })
}

function testEnv() {
  return {
    PATH: process.env.PATH ?? '',
    LANG: 'C',
    LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_OPTIONAL_LOCKS: '0',
  }
}

async function git(repoRoot, args, options = {}) {
  return execFileAsync('git', args, {
    cwd: repoRoot,
    encoding: options.encoding ?? 'utf8',
    env: testEnv(),
    maxBuffer: 40_000_000,
  })
}

async function gitBlobOid(root, ref, relativePath, allowMissing = false) {
  try {
    return (
      await git(root, ['rev-parse', `${ref}:${relativePath}`])
    ).stdout.trim()
  } catch (error) {
    if (allowMissing && error.code === 128) return null
    throw error
  }
}

async function suiteRuntimeDependencyRelatives(root) {
  const pending = [...PHASE_5_OFFLINE_TEST_FILES]
  const visited = new Set()
  const dependencies = new Set()
  while (pending.length > 0) {
    const relativePath = pending.pop()
    if (visited.has(relativePath)) continue
    visited.add(relativePath)
    const source = await readFile(join(root, relativePath), 'utf8')
    for (const match of source.matchAll(
      /(?:\bfrom\s+|^\s*import\s+)['"](\.[^'"]+\.mjs)['"]/gm,
    )) {
      const dependency = join(dirname(relativePath), match[1])
      if (!dependency.endsWith('.test.mjs')) {
        dependencies.add(dependency)
      }
      pending.push(dependency)
    }
  }
  return [...dependencies].sort()
}

async function changedSuiteRuntimeDependencies(root, lineageCommitSha) {
  const dependencies = await suiteRuntimeDependencyRelatives(REPO_ROOT)
  assert.deepEqual(dependencies, SUITE_RUNTIME_DEPENDENCY_RELATIVES)
  const changed = []
  for (const relativePath of dependencies) {
    const expectedBlob = await gitBlobOid(REPO_ROOT, 'HEAD', relativePath)
    const expectedWorktreeBlob = (
      await git(REPO_ROOT, ['hash-object', '--', relativePath])
    ).stdout.trim()
    assert.equal(expectedWorktreeBlob, expectedBlob)
    const lineageBlob = await gitBlobOid(
      root,
      lineageCommitSha,
      relativePath,
      true,
    )
    if (lineageBlob !== expectedBlob) {
      changed.push({
        relativePath,
        expectedBlob,
        expectedBytes: await readFile(join(REPO_ROOT, relativePath)),
      })
    }
  }
  assert.equal(
    changed.every(({ relativePath }) =>
      SOURCE_RUNTIME_MODULE_RELATIVES.includes(relativePath)),
    true,
    'terminal fixture omits a changed suite runtime dependency',
  )
  return changed
}

async function assertCurrentRuntimeDependenciesInstalled(root, expected) {
  for (const { relativePath, expectedBlob, expectedBytes } of expected) {
    assert.equal(
      await gitBlobOid(root, 'HEAD', relativePath),
      expectedBlob,
    )
    assert.equal(
      (
        await git(root, ['hash-object', '--', relativePath])
      ).stdout.trim(),
      expectedBlob,
    )
    assert.deepEqual(
      await readFile(join(root, relativePath)),
      expectedBytes,
    )
  }
}

async function readJson(root, relativePath) {
  return JSON.parse(await readFile(join(root, relativePath), 'utf8'))
}

async function readHistoricalEvidencePair(root, schemaVersion) {
  const commits = (
    await git(root, ['log', '--format=%H', '--', DECISION_RELATIVE])
  ).stdout.trim().split('\n').filter(Boolean)
  for (const commit of commits) {
    const decision = JSON.parse(
      (
        await git(root, ['show', `${commit}:${DECISION_RELATIVE}`])
      ).stdout,
    )
    if (decision.schema_version !== schemaVersion) continue
    const residue = JSON.parse(
      (
        await git(root, ['show', `${commit}:${RECORD_RELATIVE}`])
      ).stdout,
    )
    if (residue.schema_version === schemaVersion) {
      return { decision, residue }
    }
  }
  throw new Error(
    `historical schema v${schemaVersion} evidence pair is missing`,
  )
}

async function writeJson(root, relativePath, value) {
  await writeFile(
    join(root, relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
  )
}

async function commitPaths(root, message, paths) {
  await git(root, ['add', '--', ...paths])
  await git(root, ['commit', '-qm', message])
}

async function headSha(root) {
  return (await git(root, ['rev-parse', 'HEAD'])).stdout.trim()
}

async function runCli(root, args) {
  try {
    const result = await execFileAsync(
      process.execPath,
      [SCRIPT_RELATIVE, ...args],
      {
        cwd: root,
        encoding: 'utf8',
        env: testEnv(),
        maxBuffer: 40_000_000,
      },
    )
    return { ...result, code: 0 }
  } catch (error) {
    return {
      code: error.code,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    }
  }
}

async function refsSnapshot(root) {
  return (
    await git(root, ['show-ref', '--head'], { encoding: 'buffer' })
  ).stdout
}

async function cloneFixture(sourceRoot, owner, name) {
  const root = join(owner, name)
  await git(owner, ['clone', '--quiet', '--shared', sourceRoot, root])
  await git(root, ['config', 'user.name', 'Terminal Audit Test'])
  await git(
    root,
    ['config', 'user.email', 'terminal-audit@example.invalid'],
  )
  return root
}

async function withRepository(run) {
  const owner = await mkdtemp(join(tmpdir(), 'job-copilot-terminal-audit-'))
  const root = join(owner, 'repository')
  try {
    await git(owner, ['clone', '--quiet', '--shared', REPO_ROOT, root])
    await git(root, ['config', 'user.name', 'Terminal Audit Test'])
    await git(
      root,
      ['config', 'user.email', 'terminal-audit@example.invalid'],
    )
    const lineage = await resolveImmutableAuthenticatedV3Lineage({
      repoRoot: root,
      sourceHeadSha: await headSha(root),
      now: AUTHORIZATION_VERIFIED_AT,
    })
    await git(root, [
      'checkout',
      '--quiet',
      '--detach',
      lineage.commit_sha,
    ])
    const baseline = await readJson(root, BASELINE_RELATIVE)
    const matrix = await readJson(root, MATRIX_RELATIVE)
    const qualityReport = await readJson(root, QUALITY_RELATIVE)
    const decision = await readJson(root, DECISION_RELATIVE)
    const ownerCheckpoint = await readJson(root, RECEIPT_RELATIVE)
    const roadmap = await readFile(join(root, ROADMAP_RELATIVE), 'utf8')
    const requirements = await readFile(
      join(root, REQUIREMENTS_RELATIVE),
      'utf8',
    )
    const scan = await scanOwnedSurfaces({
      repoRoot: root,
      phaseDir: PHASE_RELATIVE,
      baseline,
      sourceHeadSha: lineage.commit_sha,
    })
    const residue = buildZeroResidueRecord({
      matrix,
      qualityReport,
      decisionContract: decision,
      ownerCheckpoint,
      baseline,
      scan,
    })
    decision.zero_residue_sha256 = residue.zero_residue_sha256
    const reconciliation = buildContractReconciliation({
      matrix,
      qualityReport,
      decision,
      ownerCheckpoint,
      residue,
      roadmapText: roadmap,
      requirementsText: requirements,
    })
    await writeJson(root, DECISION_RELATIVE, decision)
    await writeJson(root, RECORD_RELATIVE, residue)
    await writeJson(root, RECONCILIATION_RELATIVE, reconciliation)
    await commitPaths(root, 'publish fixture bootstrap v4 evidence', [
      DECISION_RELATIVE,
      RECORD_RELATIVE,
      RECONCILIATION_RELATIVE,
    ])
    const changedRuntimeDependencies =
      await changedSuiteRuntimeDependencies(root, lineage.commit_sha)
    for (const relativePath of SOURCE_MODULE_RELATIVES) {
      await writeFile(
        join(root, relativePath),
        await readFile(join(REPO_ROOT, relativePath)),
      )
    }
    const sourceStatus = (
      await git(root, [
        'status',
        '--porcelain=v1',
        '--',
        ...SOURCE_MODULE_RELATIVES,
      ])
    ).stdout
    if (sourceStatus.trim().length > 0) {
      await commitPaths(
        root,
        'install terminal lifecycle modules under test',
        SOURCE_MODULE_RELATIVES,
      )
    }
    await assertCurrentRuntimeDependenciesInstalled(
      root,
      changedRuntimeDependencies,
    )
    return await run(root)
  } finally {
    await rm(owner, { recursive: true, force: true })
    await assert.rejects(access(owner))
  }
}

function finalRoadmap(source) {
  let result = source
    .replace(
      /\*\*Plans\*\*: \d+\/\d+ plans executed/,
      `**Plans**: ${PHASE_PLAN_IDS.length}/${PHASE_PLAN_IDS.length} plans executed`,
    )
    .replace(
      /Phase 5 current gap-closure cycle: \*\*Plans\*\*: \d+\/\d+ plans executed/,
      `Phase 5 current gap-closure cycle: **Plans**: ${PHASE_PLAN_IDS.length}/${PHASE_PLAN_IDS.length} plans executed`,
    )
    .replace(
      /\| 5\. Outreach Feasibility Gate \| v1\.1 \| \d+\/\d+ \| [^|]+?\s*\|[^|]*\|/,
      `| 5. Outreach Feasibility Gate | v1.1 | ${PHASE_PLAN_IDS.length}/${PHASE_PLAN_IDS.length} | Complete | 2026-07-30 |`,
    )
  for (const plan of PHASE_PLAN_IDS) {
    result = result.replace(
      `- [ ] 05-${plan}-PLAN.md`,
      `- [x] 05-${plan}-PLAN.md`,
    )
  }
  return result
}

function finalRequirements(source) {
  return source
}

function finalState(source) {
  return source
    .replace(/^status: executing$/m, 'status: complete')
    .replace(
      /^stopped_at:.*$/m,
      `stopped_at: Completed 05-${PHASE_PLAN_IDS.at(-1)}-PLAN.md`,
    )
    .replace(
      /^  total_plans: \d+$/m,
      `  total_plans: ${PHASE_PLAN_IDS.length}`,
    )
    .replace(
      /^  completed_plans: \d+$/m,
      `  completed_plans: ${PHASE_PLAN_IDS.length}`,
    )
    .replace(/^  percent: \d+$/m, '  percent: 100')
    .replace(
      /^Phase: 05 .*$/m,
      'Phase: 05 (outreach-feasibility-gate) — COMPLETE',
    )
    .replace(
      /^Plan: \d+ of \d+$/m,
      `Plan: ${PHASE_PLAN_IDS.length} of ${PHASE_PLAN_IDS.length}`,
    )
    .replace(/^Status:.*$/m, 'Status: Complete')
}

function reviewDocument(status = 'clean', {
  paths = PHASE_5_REVIEWED_PATHS,
  findings = {
    critical: 0,
    warning: 0,
    info: 0,
    total: 0,
  },
  issueBody =
    'The standard review covered the exact 20-file Phase 5 scope and found zero unresolved findings.',
} = {}) {
  return [
    '---',
    'phase: 05-outreach-feasibility-gate',
    'reviewed: 2026-07-29T21:00:00Z',
    'depth: standard',
    `files_reviewed: ${paths.length}`,
    'files_reviewed_list:',
    ...paths.map((path) => `  - ${path}`),
    'findings:',
    `  critical: ${findings.critical}`,
    `  warning: ${findings.warning}`,
    `  info: ${findings.info}`,
    `  total: ${findings.total}`,
    `status: ${status}`,
    '---',
    '',
    '# Phase 05: Code Review Report',
    '',
    '## Summary',
    '',
    issueBody,
    '',
    '---',
    '',
    '_Reviewed: 2026-07-29T21:00:00Z_',
    '_Reviewer: the agent (gsd-code-reviewer)_',
    '_Depth: standard_',
    '',
  ].join('\n')
}

async function immutablePriorReviewBytes() {
  const { stdout } = await git(
    REPO_ROOT,
    ['show', `${PRIOR_REVIEW_COMMIT}:${REVIEW_RELATIVE}`],
    { encoding: 'buffer' },
  )
  assert.equal(
    createHash('sha256').update(stdout).digest('hex'),
    PRIOR_REVIEW_SHA256,
  )
  return stdout
}

function terminalTruthRows(
  status = 'passed',
  evidenceSnapshot = DEFAULT_VERIFICATION_SNAPSHOT,
  runnerResult = testRunnerResult(evidenceSnapshot),
) {
  const passedEvidence = buildPhase5PassedVerificationEvidence({
    ...evidenceSnapshot,
    runner_result: runnerResult,
  })
  const failedGapTruths = new Set([2, 7, 8, 9, 14, 17, 18, 19])
  return PHASE_5_VERIFICATION_TRUTHS.map(
    ([id, truth]) => ({
      id,
      truth,
      status: status === 'passed' || !failedGapTruths.has(id)
        ? '✓ VERIFIED'
        : '✗ FAILED',
      evidence: status === 'passed'
        ? passedEvidence.truths[id]
        : `Offline fixture verifies canonical truth ${id} without provider effects.`,
    }),
  )
}

function verificationDocument(status = 'passed', {
  score = null,
  truthRows = null,
  requirementRows = null,
  evidenceSnapshot = DEFAULT_VERIFICATION_SNAPSHOT,
  runnerResult = testRunnerResult(evidenceSnapshot),
} = {}) {
  const passedEvidence = buildPhase5PassedVerificationEvidence({
    ...evidenceSnapshot,
    runner_result: runnerResult,
  })
  const selectedTruthRows =
    truthRows ?? terminalTruthRows(status, evidenceSnapshot, runnerResult)
  const selectedRequirementRows = requirementRows ?? [
    {
      id: 'OUTR-04',
      status: status === 'passed' ? '✓ VERIFIED' : '✗ BLOCKED',
      evidence: status === 'passed'
        ? passedEvidence.requirements['OUTR-04']
        : 'Canonical offline evidence verifies OUTR-04 without provider effects.',
    },
    {
      id: 'OUTR-05',
      status: status === 'passed' ? '✓ VERIFIED' : '✗ BLOCKED',
      evidence: status === 'passed'
        ? passedEvidence.requirements['OUTR-05']
        : 'Canonical offline evidence verifies OUTR-05 without provider effects.',
    },
  ]
  const selectedScore = score ?? (
    status === 'passed'
      ? `${selectedTruthRows.length}/${selectedTruthRows.length}`
      : `13/${selectedTruthRows.length}`
  )
  return [
    '---',
    'phase: 05-outreach-feasibility-gate',
    'verified: 2026-07-29T21:01:00Z',
    `status: ${status}`,
    `score: ${selectedScore} must-haves verified`,
    'behavior_unverified: 0',
    'overrides_applied: 0',
    '---',
    '',
    '# Phase 5: Outreach Feasibility Gate Verification Report',
    '',
    '## Goal Achievement',
    '',
    status === 'passed'
      ? 'The accepted rights-first terminal no-go is complete.'
      : 'Lifecycle verification is not complete.',
    '',
    '### Observable Truths',
    '',
    '| # | Truth | Status | Evidence |',
    '|---|---|---|---|',
    ...selectedTruthRows.map((row) =>
      `| ${row.id} | ${row.truth} | ${row.status} | ${row.evidence} |`
    ),
    '',
    '## Requirements Coverage',
    '',
    '| Requirement | Source Plans | Description | Status | Evidence |',
    '|---|---|---|---|---|',
    ...selectedRequirementRows.map((row) =>
      `| ${row.id} | ${
        status === 'passed'
          ? '05-01 through 05-23'
          : '05-01 through 05-19'
      } | ${
        row.id === 'OUTR-04'
          ? 'Production proceeds only after permitted rights and owner acceptance; otherwise remains disabled and stopped/redesigned.'
          : 'Rights-first terminal branch truthfully closes quality as not run, zero effect, and receipt-bound owner no-go.'
        } | ${row.status} |`
        + ` ${row.evidence ?? (
          status === 'passed'
            ? passedEvidence.requirements[row.id]
            : `Canonical offline evidence verifies ${row.id} without provider effects.`
        )} |`
    ),
    '',
  ].join('\n')
}

function planSummary(plan) {
  return [
    '---',
    'phase: 05-outreach-feasibility-gate',
    `plan: ${plan}`,
    'subsystem: compliance',
    'tags: [terminal-audit]',
    'requirements-completed: [OUTR-04, OUTR-05]',
    'duration: 1 min',
    'completed: 2026-07-29',
    'status: complete',
    '---',
    '',
    `# Phase 05 Plan ${plan}: Terminal Fixture Summary`,
    '',
    '**The terminal fixture preserves the accepted rights no-go.**',
    '',
    '## Self-Check: PASSED',
    '',
  ].join('\n')
}

function utcDate(date) {
  return date.toISOString().slice(0, 10)
}

function freshRightsMatrix(matrix, now) {
  const fresh = structuredClone(matrix)
  fresh.researched_at = utcDate(now)
  fresh.valid_until = utcDate(new Date(now.getTime() + 6 * 86_400_000))
  for (const source of fresh.sources) {
    source.retrieved_at = now.toISOString()
    const { evidence_sha256: ignored, ...body } = source
    source.evidence_sha256 = sha256Json(body)
  }
  const { rights_evidence_sha256: ignored, ...body } = fresh
  fresh.rights_evidence_sha256 = sha256Json(body)
  return fresh
}

function freshLegacyDecision(legacyDecision, matrix, qualityReport) {
  const fresh = structuredClone(legacyDecision)
  fresh.rights_evidence_sha256 = matrix.rights_evidence_sha256
  fresh.quality_evidence_sha256 = qualityReport.quality_evidence_sha256
  const {
    status,
    decision_contract_sha256: ignored,
    required_owner_attestation,
    owner_attestation,
    owner_attestation_source,
    zero_residue_sha256,
    ...checkpointed
  } = fresh
  fresh.decision_contract_sha256 = sha256Json(checkpointed)
  return fresh
}

function freshLegacyResidue(
  legacyResidue,
  { matrix, qualityReport, legacyDecision, now },
) {
  const fresh = structuredClone(legacyResidue)
  fresh.rights_evidence_sha256 = matrix.rights_evidence_sha256
  fresh.quality_evidence_sha256 = qualityReport.quality_evidence_sha256
  fresh.decision_contract_sha256 =
    legacyDecision.decision_contract_sha256
  fresh.checked_at = now.toISOString()
  const { zero_residue_sha256: ignored, ...body } = fresh
  fresh.zero_residue_sha256 = sha256Json(body)
  return fresh
}

function checkpointResponseText(fields) {
  return [
    'I RECONFIRM PHASE 5 RIGHTS_NO_GO',
    'quality is NOT_RUN_RIGHTS_NO_GO',
    'production outreach search remains disabled',
    'no provider call or representative spike is permitted',
    `request nonce ${fields.nonce}`,
    `rights evidence ${fields.rights_evidence_sha256}`,
    `quality evidence ${fields.quality_evidence_sha256}`,
    `checkpointed decision ${fields.checkpointed_decision_contract_sha256}`,
    `execution baseline ${fields.baseline_evidence_sha256}.`,
  ].join('; ')
}

function freshCheckpoint({
  baseline,
  matrix,
  qualityReport,
  legacyDecision,
  now,
}) {
  const requestFields = {
    nonce: '42'.repeat(32),
    rights_evidence_sha256: matrix.rights_evidence_sha256,
    quality_evidence_sha256: qualityReport.quality_evidence_sha256,
    checkpointed_decision_contract_sha256:
      legacyDecision.decision_contract_sha256,
    baseline_evidence_sha256: baseline.baseline_evidence_sha256,
  }
  const responseBytes = Buffer.from(
    checkpointResponseText(requestFields),
    'utf8',
  )
  const requestBody = {
    schema_version: 1,
    phase: '05',
    status: 'AWAITING_OWNER_RESPONSE',
    checkpoint_plan: '05-07',
    checkpoint_task:
      "Task 1: Preserve the owner's one-time raw-byte no-go reconfirmation",
    gate: 'blocking-human',
    ...requestFields,
    required_response_sha256:
      createHash('sha256').update(responseBytes).digest('hex'),
  }
  const request = {
    ...requestBody,
    owner_checkpoint_request_sha256: sha256Json(requestBody),
  }
  const receiptBody = {
    schema_version: 1,
    phase: '05',
    status: 'OWNER_RESPONSE_RECORDED',
    checkpoint_plan: request.checkpoint_plan,
    checkpoint_task: request.checkpoint_task,
    gate: request.gate,
    owner_checkpoint_request_sha256:
      request.owner_checkpoint_request_sha256,
    nonce: request.nonce,
    rights_evidence_sha256: request.rights_evidence_sha256,
    quality_evidence_sha256: request.quality_evidence_sha256,
    checkpointed_decision_contract_sha256:
      request.checkpointed_decision_contract_sha256,
    baseline_evidence_sha256: request.baseline_evidence_sha256,
    owner_response_utf8_base64: responseBytes.toString('base64'),
    owner_response_sha256: request.required_response_sha256,
    received_at: now.toISOString(),
  }
  return {
    request,
    receipt: {
      ...receiptBody,
      owner_checkpoint_evidence_sha256: sha256Json(receiptBody),
    },
  }
}

async function installPlanInventory(root) {
  const paths = []
  for (const plan of PHASE_PLAN_IDS) {
    const planPath = `${PHASE_RELATIVE}/05-${plan}-PLAN.md`
    await writeFile(
      join(root, planPath),
      await readFile(join(REPO_ROOT, planPath)),
    )
    paths.push(planPath)
    if (plan === PHASE_PLAN_IDS.at(-1)) continue
    const summaryPath = `${PHASE_RELATIVE}/05-${plan}-SUMMARY.md`
    let summary
    try {
      summary = await readFile(join(REPO_ROOT, summaryPath))
    } catch {
      summary = planSummary(plan)
    }
    await writeFile(join(root, summaryPath), summary)
    paths.push(summaryPath)
  }
  return paths
}

function acceptedDecision({ legacyDecision, receipt }) {
  const stable = {
    schema_version: 2,
    phase: '05',
    rights_status: 'RIGHTS_NO_GO',
    quality_status: 'NOT_RUN_RIGHTS_NO_GO',
    search_authorized: false,
    production_outreach_enabled: false,
    outreach_milestone_status: 'STOPPED_RIGHTS_NO_GO',
    phase_6_authorized: false,
    phase_7_authorized: false,
    provider_call_count: 0,
    fixture_count: 0,
    raw_result_count: 0,
    production_mutation_count: 0,
    rights_evidence_sha256: legacyDecision.rights_evidence_sha256,
    quality_evidence_sha256: legacyDecision.quality_evidence_sha256,
    redesign_handoff_options:
      structuredClone(legacyDecision.redesign_handoff_options),
    redesign_selection: null,
    checkpointed_decision_contract_sha256:
      legacyDecision.schema_version >= 2
        ? legacyDecision.checkpointed_decision_contract_sha256
        : legacyDecision.decision_contract_sha256,
    owner_checkpoint_evidence_sha256:
      receipt.owner_checkpoint_evidence_sha256,
  }
  const ownerResponse = Buffer.from(
    receipt.owner_response_utf8_base64,
    'base64',
  ).toString('utf8')
  return {
    ...stable,
    status: 'RIGHTS_NO_GO_ACCEPTED',
    decision_contract_sha256: sha256Json(stable),
    required_owner_attestation: ownerResponse,
    owner_attestation: ownerResponse,
    zero_residue_sha256: '0'.repeat(64),
  }
}

function authorizationFields(authorization) {
  return {
    owner_authorization_request_sha256:
      authorization.owner_authorization_request_sha256,
    owner_authorization_signature_sha256:
      authorization.owner_authorization_signature_sha256,
    owner_authorization_principal: authorization.principal,
    owner_authorization_namespace: authorization.namespace,
    owner_authorization_key_fingerprint: authorization.fingerprint,
    owner_authorization_nonce_sha256: authorization.nonce_sha256,
    owner_authorization_issued_at: authorization.issued_at,
    owner_authorization_verified_at: authorization.verified_at,
    owner_authorization_stopped_decision_payload_sha256:
      authorization.stopped_decision_payload_sha256,
  }
}

function acceptedDecisionV3({
  legacyDecision,
  receipt,
  authorization,
}) {
  const v2 = acceptedDecision({ legacyDecision, receipt })
  const {
    status: ignoredStatus,
    decision_contract_sha256: ignoredDigest,
    required_owner_attestation: ignoredRequiredAttestation,
    owner_attestation: ignoredAttestation,
    zero_residue_sha256: ignoredResidueDigest,
    ...stableV2
  } = v2
  const stable = {
    ...stableV2,
    schema_version: 3,
    representative_case_count: 0,
    ...authorizationFields(authorization),
  }
  return {
    ...stable,
    status: 'RIGHTS_NO_GO_ACCEPTED',
    decision_contract_sha256: sha256Json(stable),
    zero_residue_sha256: '0'.repeat(64),
  }
}

function immutableResidueV3FromV4(record, template) {
  const lineage = structuredClone(record)
  lineage.schema_version = 3
  delete lineage.git_surfaces.worktree.status_paths
  delete lineage.git_surfaces.index.staged_paths
  lineage.administrative_tail_policy = {
    from_source_head_sha: lineage.source_snapshot.head_sha,
    allowed_paths: [
      ...template.administrative_tail_policy.allowed_paths,
    ],
    allowed_state_transitions: [
      ...template.administrative_tail_policy.allowed_state_transitions,
    ],
    source_changes_allowed: false,
  }
  const { zero_residue_sha256: ignored, ...body } = lineage
  lineage.zero_residue_sha256 = sha256Json(body)
  assert.equal(
    assertImmutableZeroResidueV3Lineage(lineage),
    lineage,
  )
  return lineage
}

function structuralReconciliationV1({
  matrix,
  qualityReport,
  decision,
  ownerCheckpoint,
  residue,
  roadmap,
  requirements,
}) {
  const body = {
    schema_version: 1,
    phase: '05',
    requirement_id: 'OUTR-05',
    status: 'ACCEPTED_RIGHTS_NO_GO_RECONCILED',
    original_representative_spike_intent:
      'Run a representative 6-10 application quality test only after rights clearance.',
    rights_prerequisite: 'NOT_CLEARED_RIGHTS_NO_GO',
    quality_status: 'NOT_RUN_RIGHTS_NO_GO',
    spike_executed: false,
    representative_case_count: 0,
    provider_call_count: 0,
    fixture_count: 0,
    raw_result_count: 0,
    production_mutation_count: 0,
    quality_claim: 'NONE',
    d09_resolution: 'CLEAR_PROHIBITION_CAUSED_RIGHTS_NO_GO',
    d10_resolution: 'UNRESOLVED_AMBIGUITY_CAUSED_RIGHTS_NO_GO',
    d12_resolution: 'RIGHTS_REVIEW_BLOCKED_LIVE_SPIKE',
    d13_resolution: 'OUTREACH_MILESTONE_STOPPED',
    rights_evidence_sha256: matrix.rights_evidence_sha256,
    quality_evidence_sha256:
      qualityReport.quality_evidence_sha256,
    checkpointed_decision_contract_sha256:
      decision.checkpointed_decision_contract_sha256,
    decision_contract_sha256: decision.decision_contract_sha256,
    owner_checkpoint_evidence_sha256:
      ownerCheckpoint.owner_checkpoint_evidence_sha256,
    zero_residue_sha256: residue.zero_residue_sha256,
    roadmap_semantic_sha256: sha256Json(
      extractRoadmapTerminalContract(roadmap),
    ),
    requirements_semantic_sha256: sha256Json(
      extractRequirementsTerminalContract(requirements),
    ),
  }
  return {
    ...body,
    contract_reconciliation_sha256: sha256Json(body),
  }
}

async function installPublicAuthorizationProof(root) {
  await mkdir(
    join(root, 'scripts/outreach-feasibility/trust'),
    { recursive: true },
  )
  for (const relativePath of [
    AUTHORIZATION_REQUEST_RELATIVE,
    AUTHORIZATION_SIGNATURE_RELATIVE,
    TRUST_ANCHOR_RELATIVE,
    PUBLIC_KEY_RELATIVE,
    ALLOWED_SIGNERS_RELATIVE,
  ]) {
    await copyFile(
      join(REPO_ROOT, relativePath),
      join(root, relativePath),
    )
  }
  return {
    requestPath: join(root, AUTHORIZATION_REQUEST_RELATIVE),
    signaturePath: join(root, AUTHORIZATION_SIGNATURE_RELATIVE),
    trustAnchorPath: join(root, TRUST_ANCHOR_RELATIVE),
    publicKeyPath: join(root, PUBLIC_KEY_RELATIVE),
    allowedSignersPath: join(root, ALLOWED_SIGNERS_RELATIVE),
  }
}

async function prepareFinalFixture(root) {
  const sourceRoadmap =
    await readFile(join(REPO_ROOT, ROADMAP_RELATIVE), 'utf8')
  const roadmap = finalRoadmap(sourceRoadmap)
  const requirements = finalRequirements(
    await readFile(join(REPO_ROOT, REQUIREMENTS_RELATIVE), 'utf8'),
  )
  const sourceState = await readFile(join(root, STATE_RELATIVE), 'utf8')
  const state = finalState(sourceState)
  const baseline = await readJson(root, BASELINE_RELATIVE)
  const matrix = await readJson(root, MATRIX_RELATIVE)
  const qualityReport = await readJson(root, QUALITY_RELATIVE)
  const decision = await readJson(root, DECISION_RELATIVE)
  const priorResidueV4 = await readJson(root, RECORD_RELATIVE)
  const request = await readJson(root, REQUEST_RELATIVE)
  const ownerCheckpoint = await readJson(root, RECEIPT_RELATIVE)
  const publicProof = await installPublicAuthorizationProof(root)
  await verifyOwnerAuthorization({
    ...publicProof,
    now: AUTHORIZATION_VERIFIED_AT,
  })
  assert.equal(decision.schema_version, 3)
  assert.equal(
    assertPublishableZeroResidueRecord(priorResidueV4),
    priorResidueV4,
  )
  assert.equal(priorResidueV4.schema_version, 4)
  assert.equal(
    decision.zero_residue_sha256,
    priorResidueV4.zero_residue_sha256,
  )
  const inventoryPaths = await installPlanInventory(root)
  await writeFile(
    join(root, SUMMARY_23_RELATIVE),
    planSummary(PHASE_PLAN_IDS.at(-1)),
  )
  inventoryPaths.push(SUMMARY_23_RELATIVE)
  await writeFile(join(root, ROADMAP_RELATIVE), sourceRoadmap)
  await writeFile(join(root, REQUIREMENTS_RELATIVE), requirements)
  await writeFile(join(root, STATE_RELATIVE), sourceState)
  await writeFile(
    join(root, REVIEW_RELATIVE),
    await immutablePriorReviewBytes(),
  )
  await rm(join(root, VERIFICATION_RELATIVE), { force: true })
  await writeJson(root, MATRIX_RELATIVE, matrix)
  await writeJson(root, QUALITY_RELATIVE, qualityReport)
  await writeJson(root, DECISION_RELATIVE, decision)
  await writeJson(root, RECORD_RELATIVE, priorResidueV4)
  await writeJson(root, REQUEST_RELATIVE, request)
  await writeJson(root, RECEIPT_RELATIVE, ownerCheckpoint)
  await commitPaths(root, 'prepare terminal lifecycle source state', [
    ...inventoryPaths,
    ROADMAP_RELATIVE,
    REQUIREMENTS_RELATIVE,
    STATE_RELATIVE,
    REVIEW_RELATIVE,
    MATRIX_RELATIVE,
    QUALITY_RELATIVE,
    DECISION_RELATIVE,
    RECORD_RELATIVE,
    RECONCILIATION_RELATIVE,
    REQUEST_RELATIVE,
    RECEIPT_RELATIVE,
    AUTHORIZATION_REQUEST_RELATIVE,
    AUTHORIZATION_SIGNATURE_RELATIVE,
    TRUST_ANCHOR_RELATIVE,
    PUBLIC_KEY_RELATIVE,
    ALLOWED_SIGNERS_RELATIVE,
  ])

  async function publishV4AtCurrentSource(message) {
    const sourceHeadSha = await headSha(root)
    const scan = await scanOwnedSurfaces({
      repoRoot: root,
      phaseDir: PHASE_RELATIVE,
      baseline,
      sourceHeadSha,
    })
    const residue = buildZeroResidueRecord({
      matrix,
      qualityReport,
      decisionContract: decision,
      ownerCheckpoint,
      baseline,
      scan,
    })
    decision.zero_residue_sha256 = residue.zero_residue_sha256
    const reconciliation = buildContractReconciliation({
      matrix,
      qualityReport,
      decision,
      ownerCheckpoint,
      residue,
      roadmapText: sourceRoadmap,
      requirementsText: requirements,
    })
    await writeJson(root, DECISION_RELATIVE, decision)
    await writeJson(root, RECORD_RELATIVE, residue)
    await writeJson(root, RECONCILIATION_RELATIVE, reconciliation)
    await commitPaths(root, message, [
      DECISION_RELATIVE,
      RECORD_RELATIVE,
      RECONCILIATION_RELATIVE,
    ])
    return { reconciliation, residue, scan, sourceHeadSha }
  }

  const sourceHeadSha = await headSha(root)
  for (const relativePath of SOURCE_MODULE_RELATIVES) {
    assert.equal(
      await gitBlobOid(root, sourceHeadSha, relativePath),
      (
        await git(REPO_ROOT, ['hash-object', '--', relativePath])
      ).stdout.trim(),
      relativePath,
    )
  }
  for (const plan of PHASE_PLAN_IDS) {
    for (const suffix of ['PLAN', 'SUMMARY']) {
      const relativePath =
        `${PHASE_RELATIVE}/05-${plan}-${suffix}.md`
      assert.equal(
        (
          await git(root, [
            'ls-tree',
            '-r',
            '--name-only',
            sourceHeadSha,
            '--',
            relativePath,
          ])
        ).stdout.trim(),
        relativePath,
      )
    }
  }
  const {
    reconciliation,
    residue,
  } = await publishV4AtCurrentSource(
    'publish canonical terminal v4 evidence',
  )
  const lineage = await resolveImmutableAuthenticatedV3Lineage({
    repoRoot: root,
    sourceHeadSha: await headSha(root),
    now: AUTHORIZATION_VERIFIED_AT,
  })
  assert.deepEqual(
    lineage.chain.map(({ residue_schema_version: version }) => version),
    [4, 4, 3],
  )
  await writeFile(join(root, REVIEW_RELATIVE), reviewDocument())
  await commitPaths(root, 'record canonical clean review', [
    REVIEW_RELATIVE,
  ])
  await writeFile(
    join(root, VERIFICATION_RELATIVE),
    verificationDocument('passed', {
      evidenceSnapshot: {
        source_head_sha: residue.source_snapshot.head_sha,
        controlled_tree_sha256:
          residue.source_snapshot.controlled_tree_sha256,
      },
    }),
  )
  await commitPaths(root, 'record passed Phase 5 verification', [
    VERIFICATION_RELATIVE,
  ])
  await writeFile(join(root, ROADMAP_RELATIVE), roadmap)
  await writeFile(join(root, STATE_RELATIVE), state)
  await commitPaths(root, 'complete Phase 5 tracking', [
    ROADMAP_RELATIVE,
    STATE_RELATIVE,
  ])
  return {
    baseline,
    decision,
    matrix,
    ownerCheckpoint,
    qualityReport,
    reconciliation,
    residue,
    requirements,
    roadmap,
    sourceHeadSha,
    validUntil: matrix.valid_until,
  }
}

async function addUnrelatedWork(root) {
  await mkdir(join(root, 'unrelated'), { recursive: true })
  await writeFile(join(root, 'unrelated/modified.txt'), 'tracked original\n')
  await writeFile(join(root, 'unrelated/staged.txt'), 'staged original\n')
  await commitPaths(root, 'add unrelated fixture files', [
    'unrelated/modified.txt',
    'unrelated/staged.txt',
  ])
  await writeFile(join(root, 'unrelated/modified.txt'), 'private modified\n')
  await writeFile(join(root, 'unrelated/staged.txt'), 'private staged\n')
  await git(root, ['add', '--', 'unrelated/staged.txt'])
  const privateName = 'unrelated/秘密-\n-private.txt'
  await writeFile(join(root, privateName), 'private untracked\n')
  return privateName
}

async function filesystemInventory(root) {
  const entries = []
  async function walk(relativeDirectory) {
    const children = await readdir(join(root, relativeDirectory), {
      withFileTypes: true,
    })
    for (const child of children) {
      const relativePath = join(relativeDirectory, child.name)
      if (relativePath === '.git') continue
      const metadata = await lstat(join(root, relativePath))
      if (metadata.isDirectory()) {
        await walk(relativePath)
      } else if (metadata.isFile()) {
        const bytes = await readFile(join(root, relativePath))
        entries.push({
          path: relativePath,
          mode: metadata.mode,
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        })
      }
    }
  }
  await walk('')
  return entries.sort((left, right) => left.path.localeCompare(right.path))
}

test('terminal lifecycle exposes the shared clean-only inventory validator', () => {
  assert.equal(typeof terminalAudit.assertTerminalLifecycle, 'function')
  assert.equal(PHASE_PLAN_IDS.length, 23)
  assert.equal(PHASE_PLAN_IDS.at(-1), '23')
})

test('terminal mode snapshots residue before any recovery-capable pair read', async () => {
  await withRepository(async (root) => {
    await prepareFinalFixture(root)
    await writeFile(
      join(root, DECISION_RELATIVE),
      '{"malformed":"decision"',
      { mode: 0o600 },
    )
    await writeFile(
      join(
        root,
        PHASE_RELATIVE,
        '.05-accepted-evidence.journal.json',
      ),
      '{"schema_version":1,"unknown":"irrecoverable"}\n',
      { mode: 0o600 },
    )
    const beforeHead = await headSha(root)
    const beforeRefs = await refsSnapshot(root)
    const beforeStatus = (
      await git(root, [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
      ], { encoding: 'buffer' })
    ).stdout
    const beforeFiles = await filesystemInventory(root)

    for (const mode of ['--validate-contract', '--terminal-audit']) {
      const result = await runCli(root, [
        mode,
        '--repo-root',
        '.',
        '--phase-dir',
        PHASE_RELATIVE,
      ])
      assert.notEqual(result.code, 0, mode)
      assert.equal(result.stdout, '')
      if (mode === '--validate-contract') {
        assert.match(result.stderr, /accepted evidence journal/i)
        assert.doesNotMatch(
          result.stderr,
          /malformed JSON|clean Phase 5 owned surface/i,
        )
      } else {
        assert.match(
          result.stderr,
          /clean Phase 5 owned surface/i,
        )
        assert.doesNotMatch(
          result.stderr,
          /accepted evidence journal|malformed JSON/i,
        )
      }
      assert.equal(await headSha(root), beforeHead)
      assert.deepEqual(await refsSnapshot(root), beforeRefs)
      assert.deepEqual(
        (
          await git(root, [
            'status',
            '--porcelain=v1',
            '-z',
            '--untracked-files=all',
          ], { encoding: 'buffer' })
        ).stdout,
        beforeStatus,
      )
      assert.deepEqual(await filesystemInventory(root), beforeFiles)
    }
  })
})

test('terminal fixtures migrate immutable residue v3 to canonical v4 and reject v3 as final', async () => {
  const owner = await mkdtemp(join(tmpdir(), 'terminal-v3-lineage-'))
  const root = join(owner, 'repository')
  try {
    await git(owner, ['clone', '--quiet', '--shared', REPO_ROOT, root])
    const lineage = await resolveImmutableAuthenticatedV3Lineage({
      repoRoot: root,
      sourceHeadSha: await headSha(root),
      now: AUTHORIZATION_VERIFIED_AT,
    })
    await git(root, [
      'checkout',
      '--quiet',
      '--detach',
      lineage.commit_sha,
    ])
    const record = await readJson(root, RECORD_RELATIVE)
    assert.equal(record.schema_version, 3)
    await assert.rejects(
      runContractValidation({
        repoRoot: root,
        phaseDir: PHASE_RELATIVE,
      }),
      /schema v4|publishable|terminal zero-residue/i,
    )
    await git(root, [
      'checkout',
      '--quiet',
      '--detach',
      record.source_snapshot.head_sha,
    ])
    const baseline = await readJson(root, BASELINE_RELATIVE)
    const liveScan = await scanOwnedSurfaces({
      repoRoot: root,
      phaseDir: PHASE_RELATIVE,
      baseline,
      sourceHeadSha: record.source_snapshot.head_sha,
    })
    const migrated = migrateZeroResidueV3ToV4({
      record,
      liveScan,
    })
    assert.equal(migrated.schema_version, 4)
    assert.equal(assertPublishableZeroResidueRecord(migrated), migrated)
  } finally {
    await rm(owner, { recursive: true, force: true })
  }
})

test('stable projections exclude lifecycle noise and reject semantic drift', async () => {
  await withRepository(async (root) => {
    const roadmap = finalRoadmap(
      await readFile(join(root, ROADMAP_RELATIVE), 'utf8'),
    )
    const requirements = finalRequirements(
      await readFile(join(root, REQUIREMENTS_RELATIVE), 'utf8'),
    )
    const roadmapProjection = extractRoadmapTerminalContract(roadmap)
    const requirementProjection =
      extractRequirementsTerminalContract(requirements)

    assert.deepEqual(
      extractRoadmapTerminalContract(
        roadmap
          .replaceAll('10/10', '9/10')
          .replaceAll('2026-07-29', '2027-01-01'),
      ),
      roadmapProjection,
    )
    assert.deepEqual(
      extractRequirementsTerminalContract(
        requirements.replace(
          '*Last updated: 2026-07-28',
          '*Last updated: 2027-01-01',
        ),
      ),
      requirementProjection,
    )
    assert.throws(
      () => extractRoadmapTerminalContract(
        roadmap.replaceAll('NOT_RUN_RIGHTS_NO_GO', 'PASS'),
      ),
      /terminal contract/i,
    )
    assert.throws(
      () => extractRoadmapTerminalContract(
        roadmap.replace(
          'The owner can make an evidence-backed go/no-go decision',
          'The auditor can record a lifecycle result',
        ),
      ),
      /goal|terminal contract/i,
    )
    assert.throws(
      () => extractRoadmapTerminalContract(
        roadmap.replace('Phase 5 only', 'Phase 5 and Phase 6'),
      ),
      /Phase 5|terminal contract/i,
    )
    assert.throws(
      () => extractRequirementsTerminalContract(
        requirements.replace('- [x] **OUTR-05**', '- [ ] **OUTR-05**'),
      ),
      /OUTR-05/i,
    )
    for (const probe of [
      'Phase 6 is allowed.',
      'Phase 6 is authorized, not prohibited.',
      'Production outreach has been switched on.',
    ]) {
      assert.throws(
        () => extractRoadmapTerminalContract(
          roadmap.replace(
            'Phase 5 terminal branch: the receipt-bound owner no-go',
            `${probe} Phase 5 terminal branch: `
              + 'the receipt-bound owner no-go',
          ),
        ),
        /authorization text outside the canonical grammar/i,
      )
      assert.throws(
        () => extractRequirementsTerminalContract(
          requirements.replace(
            '- [x] **OUTR-04**',
            `${probe}\n- [x] **OUTR-04**`,
          ),
        ),
        /authorization text outside the canonical grammar/i,
      )
    }
  })
})

test('reconciliation is exact, stable, and excludes mutable raw fingerprints', async () => {
  await withRepository(async (root) => {
    const evidence = await prepareFinalFixture(root)
    assert.equal(
      assertContractReconciliation(evidence.reconciliation, {
        matrix: evidence.matrix,
        qualityReport: evidence.qualityReport,
        decision: evidence.decision,
        ownerCheckpoint: evidence.ownerCheckpoint,
        residue: evidence.residue,
        roadmapText: evidence.roadmap,
        requirementsText: evidence.requirements,
      }),
      evidence.reconciliation,
    )
    for (const forbidden of [
      'head_sha',
      'roadmap_sha256',
      'requirements_sha256',
      'state_sha256',
      'project_sha256',
      'review_sha256',
      'verification_sha256',
    ]) {
      assert.equal(Object.hasOwn(evidence.reconciliation, forbidden), false)
    }
    const drifted = structuredClone(evidence.reconciliation)
    drifted.quality_claim = 'PASS'
    const { contract_reconciliation_sha256: ignored, ...body } = drifted
    drifted.contract_reconciliation_sha256 = sha256Json(body)
    assert.throws(
      () => assertContractReconciliation(drifted, {
        matrix: evidence.matrix,
        qualityReport: evidence.qualityReport,
        decision: evidence.decision,
        ownerCheckpoint: evidence.ownerCheckpoint,
        residue: evidence.residue,
        roadmapText: evidence.roadmap,
        requirementsText: evidence.requirements,
      }),
      /reconciliation|quality/i,
    )
  })
})

test('authenticated v3 reconciliation carries the exact raw proof binding', async () => {
  await withRepository(async (root) => {
    const sourceHeadSha = await headSha(root)
    const scan = await scanOwnedSurfaces({
      repoRoot: root,
      phaseDir: PHASE_RELATIVE,
      baseline: await readJson(root, BASELINE_RELATIVE),
      sourceHeadSha,
    })
    const proof = await installPublicAuthorizationProof(root)
    const authorization = await verifyOwnerAuthorization({
      ...proof,
      now: AUTHORIZATION_VERIFIED_AT,
    })
    const matrix = await readJson(root, MATRIX_RELATIVE)
    const qualityReport = await readJson(root, QUALITY_RELATIVE)
    const legacyDecision = await readJson(root, DECISION_RELATIVE)
    const ownerCheckpoint = await readJson(root, RECEIPT_RELATIVE)
    const baseline = await readJson(root, BASELINE_RELATIVE)
    const decision = acceptedDecisionV3({
      legacyDecision,
      receipt: ownerCheckpoint,
      authorization,
    })
    const residue = buildZeroResidueRecord({
      matrix,
      qualityReport,
      decisionContract: decision,
      ownerCheckpoint,
      baseline,
      scan,
    })
    decision.zero_residue_sha256 = residue.zero_residue_sha256
    const reconciliation = buildContractReconciliation({
      matrix,
      qualityReport,
      decision,
      ownerCheckpoint,
      residue,
      roadmapText: finalRoadmap(
        await readFile(join(REPO_ROOT, ROADMAP_RELATIVE), 'utf8'),
      ),
      requirementsText: finalRequirements(
        await readFile(join(REPO_ROOT, REQUIREMENTS_RELATIVE), 'utf8'),
      ),
    })

    assert.equal(reconciliation.schema_version, 2)
    for (const key of [
      'owner_authorization_request_sha256',
      'owner_authorization_signature_sha256',
      'owner_authorization_principal',
      'owner_authorization_namespace',
      'owner_authorization_key_fingerprint',
      'owner_authorization_nonce_sha256',
      'owner_authorization_stopped_decision_payload_sha256',
    ]) {
      assert.equal(reconciliation[key], decision[key], key)
    }
  })
})

test('contract validation rejects live semantic projections not covered by the owner signature', async () => {
  await withRepository(async (root) => {
    const evidence = await prepareFinalFixture(root)
    const drifted = structuredClone(evidence.reconciliation)
    drifted.requirements_semantic_sha256 = 'f'.repeat(64)
    const {
      contract_reconciliation_sha256: ignored,
      ...body
    } = drifted
    drifted.contract_reconciliation_sha256 = sha256Json(body)
    await writeJson(root, RECONCILIATION_RELATIVE, drifted)

    await assert.rejects(
      runContractValidation({
        repoRoot: root,
        phaseDir: PHASE_RELATIVE,
      }),
      /signed requirements semantic digest drift/i,
    )
  })
})

test('terminal audit is scoped, sanitized, and leaves the repository byte-identical', async () => {
  await withRepository(async (root) => {
    const evidence = await prepareFinalFixture(root)
    assert.ok(
      Date.parse(`${evidence.validUntil}T23:59:59.999Z`) >= Date.now(),
    )
    assert.equal(
      PHASE_PLAN_IDS.every((plan) =>
        evidence.roadmap.includes(
          `- [x] 05-${plan}-PLAN.md`,
        )),
      true,
    )
    const privateName = await addUnrelatedWork(root)
    const beforeHead = await headSha(root)
    const beforeStatus = (
      await git(root, [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
      ], { encoding: 'buffer' })
    ).stdout
    const beforeFiles = await filesystemInventory(root)

    const report = await runTerminalAudit({
      repoRoot: root,
      phaseDir: PHASE_RELATIVE,
      _verificationRunnerForTests: testVerificationRunner,
    })

    const afterHead = await headSha(root)
    const afterStatus = (
      await git(root, [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
      ], { encoding: 'buffer' })
    ).stdout
    const afterFiles = await filesystemInventory(root)
    assert.equal(report.status, 'TERMINAL_AUDIT_PASS')
    assert.equal(report.authoritative, true)
    assert.equal(report.live_head, beforeHead)
    assert.equal(report.source_head, evidence.sourceHeadSha)
    assert.equal(report.unrelated_worktree.entry_count, 3)
    assert.match(report.unrelated_worktree.inventory_sha256, /^[0-9a-f]{64}$/)
    assert.equal(afterHead, beforeHead)
    assert.deepEqual(afterStatus, beforeStatus)
    assert.deepEqual(afterFiles, beforeFiles)
    assert.doesNotMatch(
      JSON.stringify(report),
      /秘密|private\.txt|private untracked|unrelated\//,
    )
    assert.equal(
      await readFile(join(root, privateName), 'utf8'),
      'private untracked\n',
    )
  })
})

test('runbook and CLI argument contract are exact before repository inspection', async () => {
  assert.equal(
    TERMINAL_AUDIT_COMMAND,
    EXPECTED_TERMINAL_AUDIT_COMMAND,
  )
  assert.equal(
    TERMINAL_AUDIT_RUNBOOK,
    EXPECTED_TERMINAL_AUDIT_RUNBOOK,
  )
  const owner = await mkdtemp(join(tmpdir(), 'terminal-cli-arguments-'))
  try {
    const script = join(REPO_ROOT, SCRIPT_RELATIVE)
    const print = await execFileAsync(
      process.execPath,
      [script, '--print-runbook'],
      {
        cwd: owner,
        encoding: 'utf8',
        env: testEnv(),
      },
    )
    assert.equal(print.stdout, `${EXPECTED_TERMINAL_AUDIT_RUNBOOK}\n`)
    assert.equal(print.stderr, '')

    const invalidInvocations = [
      ['--print-runbook', '--terminal-audit'],
      ['--terminal-audit'],
      [
        '--terminal-audit',
        '--repo-root',
        '.',
        '--phase-dir',
        PHASE_RELATIVE,
        '--phase-dir',
        PHASE_RELATIVE,
      ],
      ['--validate-contract', '--repo-root', '.', '--unknown'],
      ['--print-runbook', 'positional'],
    ]
    for (const args of invalidInvocations) {
      let rejected
      try {
        await execFileAsync(process.execPath, [script, ...args], {
          cwd: owner,
          encoding: 'utf8',
          env: testEnv(),
        })
      } catch (error) {
        rejected = error
      }
      assert.ok(rejected)
      assert.notEqual(rejected.code, 0)
      assert.match(rejected.stderr, /terminal audit arguments/i)
      assert.doesNotMatch(rejected.stderr, /ENOENT|not a git repository/i)
    }
  } finally {
    await rm(owner, { recursive: true, force: true })
  }
})

test('validate-contract is explicitly non-authoritative before final lifecycle files', async () => {
  await withRepository(async (root) => {
    await prepareFinalFixture(root)
    await rm(join(root, REVIEW_RELATIVE))
    await rm(join(root, VERIFICATION_RELATIVE))
    await rm(join(root, SUMMARY_09_RELATIVE))
    await rm(join(root, SUMMARY_10_RELATIVE))
    const roadmap = await readFile(join(root, ROADMAP_RELATIVE), 'utf8')
    const state = await readFile(join(root, STATE_RELATIVE), 'utf8')
    await writeFile(
      join(root, ROADMAP_RELATIVE),
      roadmap
        .replaceAll('10/10', '9/10')
        .replace('- [x] 05-10-PLAN.md', '- [ ] 05-10-PLAN.md')
        .replace('| 10/10 | Complete |', '| 9/10 | In Progress |'),
    )
    await writeFile(
      join(root, STATE_RELATIVE),
      state
        .replace('status: complete', 'status: executing')
        .replace('completed_plans: 10', 'completed_plans: 9')
        .replace('percent: 100', 'percent: 90')
        .replace('Plan: 10 of 10', 'Plan: 9 of 10')
        .replace('Status: Complete', 'Status: Ready to execute'),
    )
    await commitPaths(root, 'remove final lifecycle state', [
      REVIEW_RELATIVE,
      VERIFICATION_RELATIVE,
      SUMMARY_09_RELATIVE,
      SUMMARY_10_RELATIVE,
      ROADMAP_RELATIVE,
      STATE_RELATIVE,
    ])
    const beforeHead = await headSha(root)
    const beforeStatus = (
      await git(root, [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
      ], { encoding: 'buffer' })
    ).stdout
    const result = await runCli(root, [
      '--validate-contract',
      '--repo-root',
      '.',
      '--phase-dir',
      PHASE_RELATIVE,
    ])
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.stderr, '')
    const report = JSON.parse(result.stdout)
    assert.equal(report.status, 'CONTRACT_VALIDATION_PASS')
    assert.equal(report.authoritative, false)
    assert.equal(await headSha(root), beforeHead)
    assert.deepEqual(
      (
        await git(root, [
          'status',
          '--porcelain=v1',
          '-z',
          '--untracked-files=all',
        ], { encoding: 'buffer' })
      ).stdout,
      beforeStatus,
    )
  })
})

test('terminal CLI is stdout-only and rejects every premature final-state variant', async () => {
  if (process.env.PHASE_5_ISOLATED_RUNNER_CHILD === '1') return
  await withRepository(async (root) => {
    await prepareFinalFixture(root)
    const privateName = await addUnrelatedWork(root)
    const beforeHead = await headSha(root)
    const beforeRefs = await refsSnapshot(root)
    const beforeStatus = (
      await git(root, [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
      ], { encoding: 'buffer' })
    ).stdout
    const beforeFiles = await filesystemInventory(root)
    const result = await runCli(root, [
      '--terminal-audit',
      '--repo-root',
      '.',
      '--phase-dir',
      PHASE_RELATIVE,
    ])
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.stderr, '')
    const report = JSON.parse(result.stdout)
    assert.equal(report.status, 'TERMINAL_AUDIT_PASS')
    assert.equal(report.authoritative, true)
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}`,
      /秘密|private\.txt|private untracked|unrelated\//,
    )
    assert.equal(await headSha(root), beforeHead)
    assert.deepEqual(await refsSnapshot(root), beforeRefs)
    assert.deepEqual(
      (
        await git(root, [
          'status',
          '--porcelain=v1',
          '-z',
          '--untracked-files=all',
        ], { encoding: 'buffer' })
      ).stdout,
      beforeStatus,
    )
    assert.deepEqual(await filesystemInventory(root), beforeFiles)
    assert.equal(
      await readFile(join(root, privateName), 'utf8'),
      'private untracked\n',
    )

    const owner = await mkdtemp(join(tmpdir(), 'terminal-variants-'))
    try {
      const variants = [
        {
          name: 'missing-review',
          mutate: async (variant) => {
            await rm(join(variant, REVIEW_RELATIVE))
            await commitPaths(variant, 'remove final review', [
              REVIEW_RELATIVE,
            ])
          },
          error: /review|lifecycle/i,
        },
        {
          name: 'non-clean-review',
          mutate: async (variant) => {
            await writeFile(
              join(variant, REVIEW_RELATIVE),
              reviewDocument('issues_found'),
            )
            await commitPaths(variant, 'reopen final review', [
              REVIEW_RELATIVE,
            ])
          },
          error: /review|lifecycle/i,
        },
        ...['skipped', 'passed', 'no_issues'].map((status) => ({
          name: `${status}-review`,
          mutate: async (variant) => {
            await writeFile(
              join(variant, REVIEW_RELATIVE),
              reviewDocument(status),
            )
            await commitPaths(variant, `record ${status} review`, [
              REVIEW_RELATIVE,
            ])
          },
          error: /review|lifecycle/i,
        })),
        ...[
          {
            name: 'stale-15-file-review',
            document: reviewDocument('clean', {
              paths: PHASE_5_REVIEWED_PATHS.slice(0, 15),
            }),
          },
          {
            name: 'reordered-review',
            document: reviewDocument('clean', {
              paths: [
                PHASE_5_REVIEWED_PATHS[1],
                PHASE_5_REVIEWED_PATHS[0],
                ...PHASE_5_REVIEWED_PATHS.slice(2),
              ],
            }),
          },
          {
            name: 'duplicate-review-path',
            document: reviewDocument('clean', {
              paths: [
                ...PHASE_5_REVIEWED_PATHS,
                PHASE_5_REVIEWED_PATHS.at(-1),
              ],
            }),
          },
          {
            name: 'extra-review-path',
            document: reviewDocument('clean', {
              paths: [
                ...PHASE_5_REVIEWED_PATHS,
                'scripts/outreach-feasibility/unreviewed-extra.mjs',
              ],
            }),
          },
          {
            name: 'nonzero-clean-review',
            document: reviewDocument('clean', {
              findings: {
                critical: 1,
                warning: 0,
                info: 0,
                total: 1,
              },
              issueBody:
                '### CR-01 [BLOCKER]: A terminal finding remains\n',
            }),
          },
        ].map(({ name, document }) => ({
          name,
          mutate: async (variant) => {
            await writeFile(join(variant, REVIEW_RELATIVE), document)
            await commitPaths(variant, `forge ${name}`, [
              REVIEW_RELATIVE,
            ])
          },
          error: /review|lifecycle|finding|scope|duplicate/i,
        })),
        {
          name: 'missing-verification',
          mutate: async (variant) => {
            await rm(join(variant, VERIFICATION_RELATIVE))
            await commitPaths(variant, 'remove final verification', [
              VERIFICATION_RELATIVE,
            ])
          },
          error: /verification|lifecycle/i,
        },
        {
          name: 'non-passed-verification',
          mutate: async (variant) => {
            await writeFile(
              join(variant, VERIFICATION_RELATIVE),
              verificationDocument('gaps_found'),
            )
            await commitPaths(variant, 'reopen verification gaps', [
              VERIFICATION_RELATIVE,
            ])
          },
          error: /verification|lifecycle/i,
        },
        ...[
          {
            name: 'zero-of-zero-verification',
            document: verificationDocument('passed', {
              score: '0/0',
            }),
          },
          {
            name: 'zero-of-many-verification',
            document: verificationDocument('passed', {
              score: '0/21',
            }),
          },
          {
            name: 'partial-verification-score',
            document: verificationDocument('passed', {
              score: '20/21',
            }),
          },
          {
            name: 'missing-verification-truth',
            document: verificationDocument('passed', {
              score: '20/20',
              truthRows: terminalTruthRows().filter((row) => row.id !== 7),
            }),
          },
          {
            name: 'duplicate-verification-truth',
            document: verificationDocument('passed', {
              score: '22/22',
              truthRows: [
                ...terminalTruthRows(),
                terminalTruthRows()[6],
              ],
            }),
          },
          {
            name: 'failed-verification-truth',
            document: verificationDocument('passed', {
              score: '20/21',
              truthRows: terminalTruthRows().map((row) => (
                row.id === 7
                  ? { ...row, status: '✗ FAILED' }
                  : row
              )),
            }),
          },
          {
            name: 'omitted-outr-04-verification',
            document: verificationDocument('passed', {
              requirementRows: [
                { id: 'OUTR-05', status: '✓ VERIFIED' },
              ],
            }),
          },
          {
            name: 'omitted-outr-05-verification',
            document: verificationDocument('passed', {
              requirementRows: [
                { id: 'OUTR-04', status: '✓ VERIFIED' },
              ],
            }),
          },
        ].map(({ name, document }) => ({
          name,
          mutate: async (variant) => {
            await writeFile(
              join(variant, VERIFICATION_RELATIVE),
              document,
            )
            await commitPaths(variant, `forge ${name}`, [
              VERIFICATION_RELATIVE,
            ])
          },
          error: /verification|score|truth|requirement/i,
        })),
        {
          name: 'incomplete-tracking',
          mutate: async (variant) => {
            const roadmap = await readFile(
              join(variant, ROADMAP_RELATIVE),
              'utf8',
            )
            const state = await readFile(
              join(variant, STATE_RELATIVE),
              'utf8',
            )
            await writeFile(
              join(variant, ROADMAP_RELATIVE),
              roadmap.replace(
                `Phase 5 current gap-closure cycle: **Plans**: ${PHASE_PLAN_IDS.length}/${PHASE_PLAN_IDS.length} plans executed`,
                `Phase 5 current gap-closure cycle: **Plans**: ${PHASE_PLAN_IDS.length - 1}/${PHASE_PLAN_IDS.length} plans executed`,
              ),
            )
            await writeFile(
              join(variant, STATE_RELATIVE),
              state.replace(
                `completed_plans: ${PHASE_PLAN_IDS.length}`,
                `completed_plans: ${PHASE_PLAN_IDS.length - 1}`,
              ),
            )
            await commitPaths(variant, 'make tracking incomplete', [
              ROADMAP_RELATIVE,
              STATE_RELATIVE,
            ])
          },
          error: /roadmap|state|lifecycle/i,
        },
        {
          name: 'dirty-phase-source',
          mutate: async (variant) => {
            await writeFile(
              join(variant, SCRIPT_RELATIVE),
              `${await readFile(
                join(variant, SCRIPT_RELATIVE),
                'utf8',
              )}\n// dirty terminal source\n`,
            )
          },
          error: /clean Phase 5 owned surface/i,
        },
        {
          name: 'staged-phase-source',
          mutate: async (variant) => {
            await writeFile(
              join(variant, SCRIPT_RELATIVE),
              `${await readFile(
                join(variant, SCRIPT_RELATIVE),
                'utf8',
              )}\n// staged terminal source\n`,
            )
            await git(variant, ['add', '--', SCRIPT_RELATIVE])
          },
          error: /clean Phase 5 owned surface/i,
        },
        {
          name: 'post-source-code-change',
          mutate: async (variant) => {
            await writeFile(
              join(variant, SCRIPT_RELATIVE),
              `${await readFile(
                join(variant, SCRIPT_RELATIVE),
                'utf8',
              )}\n// committed post-source mutation\n`,
            )
            await commitPaths(variant, 'mutate source after source head', [
              SCRIPT_RELATIVE,
            ])
          },
          error: /residue|administrative|source/i,
        },
      ]
      for (const specification of variants) {
        const variant = await cloneFixture(
          root,
          owner,
          specification.name,
        )
        await specification.mutate(variant)
        const variantHead = await headSha(variant)
        const variantRefs = await refsSnapshot(variant)
        const variantStatus = (
          await git(variant, [
            'status',
            '--porcelain=v1',
            '-z',
            '--untracked-files=all',
          ], { encoding: 'buffer' })
        ).stdout
        const variantFiles = await filesystemInventory(variant)
        const rejected = await runCli(variant, [
          '--terminal-audit',
          '--repo-root',
          '.',
          '--phase-dir',
          PHASE_RELATIVE,
        ])
        assert.notEqual(rejected.code, 0, specification.name)
        assert.match(rejected.stderr, specification.error)
        assert.equal(rejected.stdout, '')
        assert.equal(await headSha(variant), variantHead)
        assert.deepEqual(await refsSnapshot(variant), variantRefs)
        assert.deepEqual(
          (
            await git(variant, [
              'status',
              '--porcelain=v1',
              '-z',
              '--untracked-files=all',
            ], { encoding: 'buffer' })
          ).stdout,
          variantStatus,
        )
        assert.deepEqual(
          await filesystemInventory(variant),
          variantFiles,
        )
      }
    } finally {
      await rm(owner, { recursive: true, force: true })
    }
  })
})

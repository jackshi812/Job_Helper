import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  DEFAULT_MANIFEST,
  MANIFEST_CHAIN_PATHS,
  REPAIR_MANIFEST_ID,
  CATALOG_REPAIR_MANIFEST_ID,
  IDENTITY_REPAIR_MANIFEST_ID,
  assertRolloutEvidence,
  dryRunPlan,
  exactApproval,
  executeRelease,
  validateManifest,
} from './run-phase-03-9-rollout.mjs'

const CURRENT_MANIFEST =
  '.planning/phases/03.9-jpmorgan-chase-selective-oracle-monitoring/03.9-02-REPAIR-MANIFEST.json'

async function fixture() {
  const bytes = await readFile(CURRENT_MANIFEST)
  const manifest = JSON.parse(bytes)
  const hashes = await validateManifest(
    manifest,
    bytes,
    { filesAtSourceCommit: true },
  )
  return { bytes, manifest, hashes }
}

async function manifestChain() {
  return Promise.all(MANIFEST_CHAIN_PATHS.map(async (path) => {
    const bytes = await readFile(path)
    const manifest = JSON.parse(bytes)
    await validateManifest(manifest, bytes, { filesAtSourceCommit: true })
    return manifest
  }))
}

test('dry run validates frozen bytes and emits one exact approval', async () => {
  const { manifest, hashes } = await fixture()
  const plan = dryRunPlan(manifest, hashes)
  assert.equal(plan.status, 'PENDING_EXPLICIT_APPROVAL')
  assert.equal(plan.required_approval, exactApproval(manifest, hashes))
  assert.deepEqual(plan.actions, manifest.approved_actions)
})

test('mutation rejects every non-exact approval before commands run', async () => {
  const { manifest, hashes } = await fixture()
  let calls = 0
  await assert.rejects(
    executeRelease(manifest, 'approve something else', hashes, async () => {
      calls += 1
    }),
    /exact manifest\/hash-bound approval/,
  )
  assert.equal(calls, 0)
})

test('exact approval performs only the finite function repair actions', async () => {
  const { manifest, hashes } = await fixture()
  const calls = []
  const result = await executeRelease(
    manifest,
    exactApproval(manifest, hashes),
    hashes,
    async (args) => {
      calls.push(args)
      return { stdout: '', stderr: '' }
    },
  )
  assert.equal(result.status, 'DEPLOYED_PENDING_ACTIVATION')
  assert.deepEqual(calls, [
    [
      'functions', 'deploy', 'observe-connectors',
      '--project-ref', manifest.project_ref, '--no-verify-jwt', '--use-api',
    ],
    [
      'functions', 'deploy', 'poll-tick',
      '--project-ref', manifest.project_ref, '--no-verify-jwt', '--use-api',
    ],
  ])
})

test('manifest contains exact JPMorgan scope and protected siblings', async () => {
  const { manifest } = await fixture()
  assert.equal(manifest.scope.allow_missing_closure, false)
  assert.equal(manifest.scope.title_families.length, 6)
  assert.ok(manifest.protected_sources.includes('eightfold:morganstanley'))
  assert.ok(manifest.protected_sources.includes('goldman_higher:roles'))
})

test('repair approval binds only the amended two-function deployment', async () => {
  const bytes = await readFile(CURRENT_MANIFEST)
  const manifest = JSON.parse(bytes)
  const hashes = await validateManifest(
    manifest,
    bytes,
    { filesAtSourceCommit: true },
  )
  assert.equal(manifest.release_manifest_id, REPAIR_MANIFEST_ID)
  assert.match(
    exactApproval(manifest, hashes),
    /^approve Phase 03\.9 JPMorgan function repair /,
  )
  assert.equal(manifest.hosted_baseline.last_migration, '0045')
  assert.equal(manifest.approved_actions.includes('db_push_0045'), false)
})

test('catalog repair approval binds only migration 0046 before activation', async () => {
  const bytes = await readFile(
    '.planning/phases/03.9-jpmorgan-chase-selective-oracle-monitoring/03.9-03-CATALOG-REPAIR-MANIFEST.json',
  )
  const manifest = JSON.parse(bytes)
  const hashes = await validateManifest(
    manifest,
    bytes,
    { filesAtSourceCommit: true },
  )
  assert.equal(manifest.release_manifest_id, CATALOG_REPAIR_MANIFEST_ID)
  assert.match(
    exactApproval(manifest, hashes),
    /^approve Phase 03\.9 JPMorgan catalog repair /,
  )
  const calls = []
  await executeRelease(
    manifest,
    exactApproval(manifest, hashes),
    hashes,
    async (args) => {
      calls.push(args)
      return { stdout: '', stderr: '' }
    },
  )
  assert.deepEqual(calls, [['db', 'push', '--linked', '--yes']])
})

test('identity repair approval binds only migration 0047 before activation', async () => {
  const bytes = await readFile(
    '.planning/phases/03.9-jpmorgan-chase-selective-oracle-monitoring/03.9-04-IDENTITY-REPAIR-MANIFEST.json',
  )
  const manifest = JSON.parse(bytes)
  const hashes = await validateManifest(
    manifest,
    bytes,
    { filesAtSourceCommit: true },
  )
  assert.equal(manifest.release_manifest_id, IDENTITY_REPAIR_MANIFEST_ID)
  assert.match(
    exactApproval(manifest, hashes),
    /^approve Phase 03\.9 JPMorgan identity repair /,
  )
  const calls = []
  await executeRelease(
    manifest,
    exactApproval(manifest, hashes),
    hashes,
    async (args) => {
      calls.push(args)
      return { stdout: '', stderr: '' }
    },
  )
  assert.deepEqual(calls, [['db', 'push', '--linked', '--yes']])
})

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

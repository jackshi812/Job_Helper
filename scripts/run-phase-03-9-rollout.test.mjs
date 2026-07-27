import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  DEFAULT_MANIFEST,
  dryRunPlan,
  exactApproval,
  executeRelease,
  validateManifest,
} from './run-phase-03-9-rollout.mjs'

async function fixture() {
  const bytes = await readFile(DEFAULT_MANIFEST)
  const manifest = JSON.parse(bytes)
  const hashes = await validateManifest(manifest, bytes)
  return { bytes, manifest, hashes }
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

test('exact approval performs only the finite migration and function actions', async () => {
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
    ['db', 'push', '--linked', '--yes'],
    [
      'functions', 'deploy', 'observe-connectors',
      '--project-ref', manifest.project_ref, '--no-verify-jwt',
    ],
    [
      'functions', 'deploy', 'poll-tick',
      '--project-ref', manifest.project_ref, '--no-verify-jwt',
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

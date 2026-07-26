#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  DEFAULT_MANIFEST,
  RELEASE_MANIFEST_ID,
  validateManifest,
} from './run-phase-03-9-rollout.mjs'

const DEFAULT_OUTPUT =
  '.planning/phases/03.9-jpmorgan-chase-selective-oracle-monitoring/03.9-01-HOSTED-VERIFICATION.json'

export function evaluateHostedSnapshot(manifest, snapshot) {
  const checks = {
    migration_0045: snapshot.remote_migrations?.includes('0045') === true,
    function_parity: ['observe-connectors', 'poll-tick'].every(
      (slug) => snapshot.functions?.[slug]?.status === 'ACTIVE'
        && snapshot.functions[slug].verify_jwt === manifest.functions[slug].verify_jwt,
    ),
    exact_catalog: snapshot.catalog?.source_key === manifest.source_key
      && snapshot.catalog?.careers_url === manifest.public_url,
    activation: snapshot.company?.source_key === manifest.source_key
      && snapshot.company?.activation_state === 'active'
      && snapshot.company?.activation_successes === 3,
    natural_poll: snapshot.company?.last_success_at != null
      && snapshot.company?.last_polled_at != null
      && snapshot.company?.last_error_code == null,
    eligible_job: Number(snapshot.eligible_job_count) > 0,
    closure_disabled: Number(snapshot.absence_closed_count) === 0,
    protected_sources: snapshot.protected_sources_unchanged === true,
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

function parseArgs(argv) {
  const result = {
    manifest: DEFAULT_MANIFEST,
    snapshot: null,
    output: DEFAULT_OUTPUT,
  }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--manifest') result.manifest = argv[++index]
    else if (argv[index] === '--snapshot') result.snapshot = argv[++index]
    else if (argv[index] === '--output') result.output = argv[++index]
    else throw new Error(`unknown argument: ${argv[index]}`)
  }
  return result
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const manifestBytes = await readFile(resolve(args.manifest))
  const manifest = JSON.parse(manifestBytes)
  await validateManifest(manifest, manifestBytes)
  const snapshot = args.snapshot
    ? JSON.parse(await readFile(resolve(args.snapshot), 'utf8'))
    : {}
  const result = evaluateHostedSnapshot(manifest, snapshot)
  await writeFile(resolve(args.output), `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

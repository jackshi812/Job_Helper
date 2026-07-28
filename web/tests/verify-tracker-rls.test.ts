import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import verifierSource from '../../scripts/verify-tracker-rls.ts?raw'

const root = resolve(import.meta.dirname, '../..')
const verifier = resolve(root, 'scripts/verify-tracker-rls.ts')

describe('tracker hosted RLS verifier contract', () => {
  it('exposes only contract and checksum-bound hosted modes', () => {
    expect(verifierSource).toMatch(/--mode\s+contract\|hosted/)
    expect(verifierSource).toContain("'--preflight'")
    expect(verifierSource).toContain("'--catalog-evidence'")
    expect(verifierSource).toContain("'--evidence'")
    expect(verifierSource).toMatch(/unknown (?:argument|flag)/i)
    expect(verifierSource).not.toMatch(/--(?:service-key|secret-key|token|password)/)
  })

  it('publishes a manifest with only directly seedable identifiers', () => {
    const output = execFileSync(
      process.execPath,
      ['--experimental-strip-types', verifier, '--mode', 'contract'],
      { cwd: root, encoding: 'utf8' },
    )
    const contract = JSON.parse(output) as {
      fixture_manifest: {
        namespace: string
        auth_users: unknown[]
        companies: unknown[]
        jobs: unknown[]
        user_jobs: unknown[]
        resumes: unknown[]
        [key: string]: unknown
      }
      expected_counts: {
        applications: number
        application_stage_events: number
      }
      lineage_rules: string[]
    }

    expect(contract.fixture_manifest.namespace).toMatch(/^phase-04-tracker-/)
    expect(contract.fixture_manifest.auth_users).toHaveLength(2)
    expect(contract.fixture_manifest.companies).toHaveLength(1)
    expect(contract.fixture_manifest.jobs).toHaveLength(1)
    expect(contract.fixture_manifest.user_jobs).toHaveLength(2)
    expect(contract.fixture_manifest.resumes).toHaveLength(2)
    expect(contract.fixture_manifest).not.toHaveProperty('applications')
    expect(contract.fixture_manifest).not.toHaveProperty(
      'application_stage_events',
    )
    expect(contract.expected_counts.applications).toBeGreaterThan(0)
    expect(contract.expected_counts.application_stage_events).toBeGreaterThan(0)
    expect(contract.lineage_rules.join(' ')).toMatch(
      /runtime.*owner.*parent.*namespace.*count/i,
    )
  })

  it('keeps service authority memory-only and behavior on two ordinary sessions', () => {
    expect(verifierSource).toMatch(/'projects',\s*'api-keys'/)
    expect(verifierSource).toContain("'--reveal'")
    expect(verifierSource).toMatch(/'--output',\s*'json'/)
    expect(verifierSource).toMatch(/service_role/)
    expect(verifierSource).toMatch(/recursive.*redact|redact.*recursive/is)
    expect(verifierSource).toMatch(/signInWithPassword/)
    expect(verifierSource).toMatch(/sessionA/)
    expect(verifierSource).toMatch(/sessionB/)
    expect(verifierSource).toMatch(/ordinary/i)
    expect(verifierSource).toMatch(/p_company/)
    expect(verifierSource).toMatch(/p_title/)
    expect(verifierSource).toMatch(/p_apply_url/)
    expect(verifierSource).toMatch(/p_notes/)
    expect(verifierSource).toMatch(/p_stage/)
    expect(verifierSource).toMatch(/p_occurred_on/)
    expect(verifierSource).toContain('duplicate_warning')
    expect(verifierSource).toContain(
      'application_id, company, title, location, apply_url, applied_on, current_stage, current_stage_date',
    )
  })

  it('exposes only allowlisted step and elapsed-time diagnostics', () => {
    const output = execFileSync(
      process.execPath,
      ['--experimental-strip-types', verifier, '--mode', 'contract'],
      { cwd: root, encoding: 'utf8' },
    )
    const contract = JSON.parse(output) as {
      diagnostics: {
        steps: string[]
        output_fields: string[]
        statuses: string[]
      }
    }

    expect(contract.diagnostics.output_fields).toEqual([
      'step',
      'status',
      'elapsed_ms',
    ])
    expect(contract.diagnostics.statuses).toEqual(['start', 'pass', 'fail'])
    expect(contract.diagnostics.steps.length).toBeGreaterThan(30)
    expect(new Set(contract.diagnostics.steps).size).toBe(
      contract.diagnostics.steps.length,
    )

    for (const step of contract.diagnostics.steps) {
      expect(step).toMatch(/^[a-z][a-z0-9_.]{2,79}$/)
      expect(step).not.toMatch(
        /(?:https?|url|email|password|token|secret|key|content|notes|description|[a-f0-9]{8}-[a-f0-9-]{27,})/i,
      )
    }

    expect(verifierSource).toMatch(/function writeDiagnostic/)
    expect(verifierSource).toMatch(/process\.stderr\.write/)
    expect(verifierSource).toMatch(/elapsed_ms/)
    expect(verifierSource).toMatch(/step:\s*DiagnosticStep/)
    expect(verifierSource).not.toMatch(
      /writeDiagnostic\([^)]*(?:url|payload|secrets|userId|accessToken)/,
    )
  })

  it('labels every timed fetch failure without rendering response content', () => {
    const httpJsonBody = verifierSource.match(
      /async function httpJson\(([\s\S]*?)\n}\n\nfunction serviceHeaders/,
    )?.[0]
    expect(httpJsonBody).toBeDefined()
    expect(httpJsonBody).toMatch(/writeDiagnostic\(step,\s*'start'/)
    expect(httpJsonBody).toMatch(/writeDiagnostic\(step,\s*'pass'/)
    expect(httpJsonBody).toMatch(/writeDiagnostic\(step,\s*'fail'/)
    expect(httpJsonBody).toMatch(/AbortSignal\.timeout\(30_000\)/)
    expect(httpJsonBody).not.toMatch(
      /sanitizedError\(\s*\{[\s\S]*?payload[\s\S]*?\}/,
    )
    expect(httpJsonBody).not.toMatch(
      /writeDiagnostic\([^)]*(?:response|payload|text|url|secrets)/,
    )
  })

  it('derives RPC lineage in memory and cleans exactly seven relations', () => {
    expect(verifierSource).toMatch(/memory-only.*lineage|lineage.*memory-only/is)
    expect(verifierSource).toMatch(/owner.*parent.*namespace.*count/is)
    expect(verifierSource).toMatch(/finally\s*\{/)
    expect(verifierSource).toMatch(/exact expected count/i)
    expect(verifierSource).toMatch(/zero residue/i)

    for (const relation of [
      'public.application_stage_events',
      'public.applications',
      'public.user_jobs',
      'public.resumes',
      'public.jobs',
      'public.companies',
      'auth.users',
    ]) {
      expect(verifierSource).toContain(relation)
    }
  })

  it('requires a current catalog PASS and all approval-bound hashes before seeding', () => {
    expect(verifierSource).toMatch(/catalog_evidence_sha256/)
    expect(verifierSource).toMatch(/migration_sha256/)
    expect(verifierSource).toMatch(/schema_verifier_sha256/)
    expect(verifierSource).toMatch(/behavior_verifier_sha256/)
    expect(verifierSource).toMatch(/fixture_manifest_sha256/)
    expect(verifierSource).toMatch(/catalog.*PASS.*seed|seed.*catalog.*PASS/is)
    expect(verifierSource).toMatch(/drift/i)
  })
})

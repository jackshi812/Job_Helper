import { describe, expect, it } from 'vitest'
import migration0053 from '../../supabase/migrations/0053_application_tracker.sql?raw'
import verifierSource from '../../scripts/verify-tracker-schema.ts?raw'

describe('tracker schema verifier contract', () => {
  it('exposes only the checksum-bound preflight and hosted assertion modes', () => {
    expect(verifierSource).toMatch(/--mode\s+preflight\|assert-hosted/)
    expect(verifierSource).toContain("'--migration'")
    expect(verifierSource).toContain("'--output'")
    expect(verifierSource).toContain("'--preflight'")
    expect(verifierSource).toContain("'--evidence'")
    expect(verifierSource).toMatch(/unknown (?:argument|flag)/i)
    const parserAllowlist = verifierSource.match(
      /const allowed = new Set\(\[([\s\S]*?)\]\)/,
    )?.[1]
    expect(parserAllowlist).toBeDefined()
    expect(parserAllowlist).not.toMatch(
      /--(?:sql|query|project-ref|token|password)/,
    )
  })

  it('inventories every reviewed catalog and ACL surface before hosted PASS', () => {
    for (const catalog of [
      'supabase_migrations.schema_migrations',
      'pg_catalog.pg_class',
      'pg_catalog.pg_attribute',
      'pg_catalog.pg_constraint',
      'pg_catalog.pg_indexes',
      'pg_catalog.pg_trigger',
      'pg_catalog.pg_proc',
      'pg_catalog.pg_policy',
      'information_schema.table_privileges',
      'information_schema.column_privileges',
      'information_schema.routine_privileges',
      'pg_get_constraintdef',
      'pg_get_indexdef',
      'pg_get_triggerdef',
      'pg_get_functiondef',
    ]) {
      expect(verifierSource).toContain(catalog)
    }

    expect(verifierSource).toMatch(/hosted_catalog_sha256/)
    expect(verifierSource).toMatch(/catalog_evidence_sha256/)
    expect(verifierSource).toMatch(/legacy_applied_(?:baseline|count)/)
    expect(verifierSource).toMatch(/backfill/i)
  })

  it('pins the exact manual-create and Dashboard applied contracts', () => {
    const manualSignature =
      'create_manual_application(text, text, text, text, text, date)'
    expect(migration0053).toContain(manualSignature)
    expect(verifierSource).toContain(manualSignature)
    expect(verifierSource).toContain('application_id uuid, duplicate_warning boolean')

    const dashboardColumns = [
      'application_id uuid',
      'company text',
      'title text',
      'location text',
      'apply_url text',
      'applied_on date',
      'current_stage text',
      'current_stage_date date',
    ]
    for (const column of dashboardColumns) {
      expect(verifierSource).toContain(column)
    }
    expect(verifierSource).toContain(
      'ORDER BY occurred_on ASC, created_at ASC, id ASC LIMIT 1',
    )
    expect(verifierSource).toMatch(/https.*credentials|credentials.*https/is)
  })

  it('writes only sanitized catalog evidence and fails closed on drift', () => {
    expect(verifierSource).toMatch(/SUPABASE_ACCESS_TOKEN/)
    expect(verifierSource).toMatch(/api\.supabase\.com\/v1\/projects/)
    expect(verifierSource).toMatch(/database\/query/)
    expect(verifierSource).toMatch(/sanitize|redact/i)
    expect(verifierSource).toMatch(/credential|secret|token/i)
    expect(verifierSource).toMatch(/throw new Error|process\.exitCode\s*=\s*1/)
    expect(verifierSource).toMatch(/sole pending|0053_application_tracker\.sql/i)
    expect(verifierSource).not.toMatch(
      /console\.(?:log|error)\([^)]*(?:SUPABASE_ACCESS_TOKEN|authorization)/,
    )
  })
})

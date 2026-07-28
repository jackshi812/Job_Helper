import { describe, expect, it } from 'vitest'
import migration0056 from '../../supabase/migrations/0056_delete_tracker_application.sql?raw'
import verifierSource from '../../scripts/verify-tracker-delete.ts?raw'

describe('tracker application delete verifier', () => {
  it('accepts only checksum-bound preflight and hosted assertion modes', () => {
    expect(verifierSource).toContain('--mode preflight|assert-hosted')
    expect(verifierSource).toContain("'--migration'")
    expect(verifierSource).toContain("'--output'")
    expect(verifierSource).toContain("'--preflight'")
    expect(verifierSource).toContain("'--evidence'")
    expect(verifierSource).toContain('sole-pending')
    expect(verifierSource).toContain('dry_run_sha256')
    expect(verifierSource).toContain('source_commit')
  })

  it('binds the exact 0056 owner-delete contract', () => {
    expect(verifierSource).toContain('0056_delete_tracker_application.sql')
    expect(verifierSource).toContain(
      'create function public.delete_tracker_application(p_application_id uuid)',
    )
    expect(verifierSource).toContain('application.user_id = owner_id')
    expect(verifierSource).toContain('delete from public.applications')
    expect(verifierSource).toMatch(/public\\?\.user_jobs\|applied_at/)
    expect(migration0056).not.toContain('public.user_jobs')
  })

  it('checks hosted migration, security metadata, ACL, owner predicate, and immutable applied history', () => {
    for (const marker of [
      'migration_present',
      'postgres_owner',
      'boolean_result',
      'security_definer',
      'empty_search_path',
      'authenticated_execute',
      'anon_execute',
      'owner_predicate',
      'deletes_application',
      'preserves_user_jobs',
      'definition_sha256',
    ]) {
      expect(verifierSource).toContain(marker)
    }
    expect(verifierSource).toContain('api.supabase.com/v1/projects/')
    expect(verifierSource).toContain('SUPABASE_ACCESS_TOKEN')
    expect(verifierSource).not.toMatch(
      /console\.(?:log|error)\([^)]*(?:SUPABASE_ACCESS_TOKEN|authorization)/i,
    )
  })
})

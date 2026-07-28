import { describe, expect, it } from 'vitest'
import verifier from '../../scripts/verify-final-delete-all.ts?raw'

describe('final-schema delete-all hosted verifier', () => {
  it('uses a disposable authenticated owner and cleans it in finally', () => {
    expect(verifier).toMatch(/admin\.auth\.admin\.createUser/i)
    expect(verifier).toMatch(/user\.auth\.signInWithPassword/i)
    expect(verifier).toMatch(
      /finally \{[\s\S]*admin\.storage\.from\('resumes'\)\.remove\(\[storagePath\]\)[\s\S]*admin\.auth\.admin\.deleteUser/i,
    )
    expect(verifier).toMatch(/finally \{[\s\S]*admin\.auth\.admin\.deleteUser/i)
  })

  it('seeds and proves every current personal relation', () => {
    for (const table of [
      'applications',
      'application_stage_events',
      'user_job_dismissals',
      'deterministic_ranking_state',
      'deterministic_ranking_runs',
      'deterministic_ranking_items',
      'ai_usage',
      'resume_extracts',
      'resumes',
      'preferences',
      'user_jobs',
    ]) {
      expect(verifier).toContain(`'${table}'`)
    }
    expect(verifier).toContain("'create_manual_application'")
    expect(verifier).toContain("user.rpc('delete_my_data')")
  })

  it('preserves the storage-first contract and verifies retained identity', () => {
    const remove = verifier.indexOf(".remove([storagePath])")
    const rpc = verifier.indexOf("user.rpc('delete_my_data')")
    expect(remove).toBeGreaterThan(-1)
    expect(rpc).toBeGreaterThan(remove)
    expect(verifier).toMatch(/profileCount !== 1/i)
    expect(verifier).toMatch(/admin\.auth\.admin\.getUserById\(userId\)/i)
  })
})

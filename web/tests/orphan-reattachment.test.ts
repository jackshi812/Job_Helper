import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const pollTickSource = readFileSync(fileURLToPath(new URL(
  '../../supabase/functions/poll-tick/index.ts',
  import.meta.url,
)), 'utf8')

describe('orphaned direct-source job recovery', () => {
  it('reattaches only unowned exact provider IDs without replacing snapshots', () => {
    const start = pollTickSource.indexOf('async function reattachOrphanedJobs')
    const end = pollTickSource.indexOf('\nasync function ingestNewJobs', start)
    const implementation = pollTickSource.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(implementation).toContain(".update({ company_id: company.id })")
    expect(implementation).toContain(".is('company_id', null)")
    expect(implementation).toContain(".eq('source', source)")
    expect(implementation).toContain(".in('external_id', batch)")
    expect(implementation).not.toMatch(/description_|title:|absolute_url|fingerprint:/)
  })

  it('merges reattached rows before lifecycle planning', () => {
    const reattachAt = pollTickSource.indexOf(
      'const reattached = await reattachOrphanedJobs',
    )
    const planAt = pollTickSource.indexOf('const plan = planCompanySync', reattachAt)

    expect(reattachAt).toBeGreaterThan(-1)
    expect(planAt).toBeGreaterThan(reattachAt)
  })
})

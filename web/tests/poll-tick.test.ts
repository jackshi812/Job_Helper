import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BoundedPoolDeadlineError,
  DEFAULT_BRANDED_COMPANY_CONCURRENCY,
  DEFAULT_BRANDED_STOP_SCHEDULING_MS,
  runBoundedPool,
} from '../../supabase/functions/_shared/bounded-pool'
import {
  planCompanySync,
} from '../../supabase/functions/_shared/lifecycle'

const pollTickSource = readFileSync(fileURLToPath(new URL(
  '../../supabase/functions/poll-tick/index.ts',
  import.meta.url,
)), 'utf8')

describe('bounded Active company polling', () => {
  it('wires the company runner to the shared two-company 120-second bounded pool', () => {
    expect(DEFAULT_BRANDED_COMPANY_CONCURRENCY).toBe(2)
    expect(DEFAULT_BRANDED_STOP_SCHEDULING_MS).toBe(120_000)
    expect(pollTickSource).toMatch(/runBoundedPool\(\s*companies/)
    expect(pollTickSource).toMatch(/concurrency:\s*DEFAULT_BRANDED_COMPANY_CONCURRENCY/)
    expect(pollTickSource).toMatch(/deadlineMs:\s*DEFAULT_BRANDED_STOP_SCHEDULING_MS/)
    expect(pollTickSource).not.toMatch(
      /Promise\.allSettled\(\s*companies\.map/,
    )
  })

  it('caps concurrent companies and preserves successful siblings around failure', async () => {
    let active = 0
    let peak = 0
    const settled = await runBoundedPool(
      ['first', 'failure', 'last'],
      async (value) => {
        active += 1
        peak = Math.max(peak, active)
        await Promise.resolve()
        active -= 1
        if (value === 'failure') throw new Error('provider_schema_invalid')
        return value
      },
      {
        concurrency: DEFAULT_BRANDED_COMPANY_CONCURRENCY,
        deadlineMs: DEFAULT_BRANDED_STOP_SCHEDULING_MS,
      },
    )

    expect(peak).toBe(2)
    expect(settled.map((result) => result.status)).toEqual([
      'fulfilled',
      'rejected',
      'fulfilled',
    ])
  })

  it('starts no additional company after the scheduling reserve expires', async () => {
    let now = 0
    const started: number[] = []

    await expect(runBoundedPool(
      [0, 1, 2, 3],
      async (value) => {
        started.push(value)
        now = DEFAULT_BRANDED_STOP_SCHEDULING_MS
        return value
      },
      {
        concurrency: DEFAULT_BRANDED_COMPANY_CONCURRENCY,
        deadlineMs: DEFAULT_BRANDED_STOP_SCHEDULING_MS,
        now: () => now,
        scheduleTimeout: () => 1,
        cancelTimeout: () => undefined,
      },
    )).rejects.toMatchObject({
      code: 'bounded_pool_deadline',
      startedCount: 2,
    } satisfies Partial<BoundedPoolDeadlineError>)
    expect(started).toEqual([0, 1])
  })

  it('retains last-known jobs and closes none for incomplete observations', () => {
    const existing = [{
      id: 'job-1',
      source: 'eightfold',
      external_id: 'ms-1',
      fingerprint: 'fingerprint',
      status: 'open' as const,
      last_seen_at: '2026-07-25T00:00:00.000Z',
    }]

    const plan = planCompanySync(existing, {
      jobs: [],
      completeness: 'partial',
      credibleForClosure: false,
      allowMissingClosure: false,
      pageCount: 1,
      expectedCount: 1,
      warnings: ['provider_schema_invalid'],
    }, '2026-07-26T00:00:00.000Z')

    expect(plan.closeIds).toEqual([])
  })

  it('persists constrained branded provenance in the same job row', () => {
    expect(pollTickSource).toMatch(/scope_evidence:\s*normalized\.scopeEvidence/)
    expect(pollTickSource).toMatch(/validateBrandedPersistenceEvidence/)
    expect(pollTickSource).toMatch(/externalIdDigest/)
    expect(pollTickSource).toMatch(/detailCountryCode\s*!==\s*'US'/)
  })
})

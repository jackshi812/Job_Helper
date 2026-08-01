import { describe, expect, it } from 'vitest'
import {
  DeterministicWorkerDeadlineError,
  runDeterministicWorker,
  type DeterministicWorkerClient,
} from '../../supabase/functions/_shared/deterministic-worker.ts'

interface Operation {
  kind: 'rpc' | 'table'
  name: string
  args?: Record<string, unknown>
  signal?: AbortSignal
}

type Result = { data: unknown; error: unknown }
type Resolver = (signal: AbortSignal) => Promise<Result> | Result

class FaithfulBuilder implements PromiseLike<Result> {
  private signal?: AbortSignal

  constructor(
    private readonly operation: Operation,
    private readonly resolver: Resolver,
  ) {}

  select() { return this }
  in() { return this }
  eq() { return this }
  not() { return this }
  order() { return this }
  limit() { return this }

  abortSignal(signal: AbortSignal) {
    this.signal = signal
    this.operation.signal = signal
    return this
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    if (!this.signal) {
      return Promise.reject(new Error('operation_missing_abort_signal')).then(
        onfulfilled,
        onrejected,
      )
    }
    return Promise.resolve(this.resolver(this.signal)).then(
      onfulfilled,
      onrejected,
    )
  }
}

function abortableNever(signal: AbortSignal): Promise<Result> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new DOMException('deadline', 'AbortError'))
      return
    }
    signal.addEventListener(
      'abort',
      () => reject(new DOMException('deadline', 'AbortError')),
      { once: true },
    )
  })
}

function claimedRow() {
  return {
    item_id: 'item-1',
    run_id: 'run-1',
    user_id: 'user-1',
    user_job_id: 'user-job-1',
    job_id: 'job-1',
    revision: 1,
    evaluation_time: '2026-07-23T20:00:00.000Z',
    captured_titles: ['Protocol Engineer'],
    captured_locations: [],
    captured_include_keywords: [],
    captured_exclude_keywords: [],
    captured_title_exclude_keywords: [],
    captured_max_required_experience: null,
    captured_rubric: {
      strictTitle: 30,
      weakTitle: 20,
      preferredLocation: 10,
      recency: 10,
      watchlist: 10,
      experience: 20,
      includeKeywordSteps: {
        one: 3,
        two: 5,
        three: 10,
        four: 15,
        fivePlus: 20,
      },
    },
    captured_good_threshold: 50,
    captured_strong_threshold: 75,
  }
}

function runtime({
  hangTable,
  hangRpc,
  missingJobs,
  stagedCount = 1,
}: {
  hangTable?: string
  hangRpc?: string
  missingJobs?: boolean
  stagedCount?: number
} = {}) {
  const operations: Operation[] = []
  let claimCount = 0
  const client: DeterministicWorkerClient = {
    rpc(name, args) {
      const operation: Operation = { kind: 'rpc', name, args }
      operations.push(operation)
      return new FaithfulBuilder(operation, (signal) => {
        if (hangRpc === name) return abortableNever(signal)
        if (name === 'claim_deterministic_ranking_work') {
          claimCount += 1
          return {
            data: claimCount === 1 ? [claimedRow()] : [],
            error: null,
          }
        }
        if (name === 'stage_deterministic_ranking_results') {
          return { data: stagedCount, error: null }
        }
        if (name === 'finalize_deterministic_ranking_run') {
          return { data: [{ status: 'completed', published: true }], error: null }
        }
        return { data: [{ initialized_count: 0, seeded_count: 0 }], error: null }
      })
    },
    from(name) {
      const operation: Operation = { kind: 'table', name }
      operations.push(operation)
      return new FaithfulBuilder(operation, (signal) => {
        if (hangTable === name) return abortableNever(signal)
        if (name === 'jobs') {
          return {
            data: missingJobs ? [] : [{
              id: 'job-1',
              title: 'Protocol Engineer',
              location: 'Chicago, IL',
              description_text: 'Local runtime fixture.',
              posted_at: '2026-07-23T19:30:00.000Z',
              company_id: null,
              deterministic_input_revision: 7,
            }],
            error: null,
          }
        }
        return { data: [], error: null }
      })
    },
  }
  return { client, operations }
}

const deadlineOptions = {
  maxInvocationMs: 40,
  cleanupMarginMs: 5,
}

describe('actual deterministic worker runtime', () => {
  it('loads jobs once and stages one exact record batch before finalization', async () => {
    const { client, operations } = runtime()

    const result = await runDeterministicWorker({ client, ...deadlineOptions })
    const jobLoads = operations.filter((operation) => operation.name === 'jobs')
    const stages = operations.filter(
      (operation) => operation.name === 'stage_deterministic_ranking_results',
    )
    const finalizerIndex = operations.findIndex(
      (operation) => operation.name === 'finalize_deterministic_ranking_run',
    )

    expect(result).toMatchObject({ claimed: 1, completed: 1, failed: 0 })
    expect(jobLoads).toHaveLength(1)
    expect(stages).toHaveLength(1)
    expect(stages[0]?.args).toEqual({
      p_results: [{
        item_id: 'item-1',
        revision: 1,
        job_input_revision: 7,
        eligible: true,
        score: 40,
        tier: 'Weak',
        breakdown: expect.any(Array),
        filter_code: null,
        filter_detail: null,
        best_fit_resume_id: null,
        runner_up_resume_id: null,
        error_code: null,
      }],
    })
    expect(finalizerIndex).toBeGreaterThan(operations.indexOf(stages[0]!))
  })

  it('puts evaluator failures in the same single batch RPC', async () => {
    const { client, operations } = runtime({ missingJobs: true })

    const result = await runDeterministicWorker({ client, ...deadlineOptions })
    const stages = operations.filter(
      (operation) => operation.name === 'stage_deterministic_ranking_results',
    )

    expect(result).toMatchObject({ claimed: 1, completed: 0, failed: 1 })
    expect(stages).toHaveLength(1)
    expect(stages[0]?.args).toEqual({
      p_results: [{
        item_id: 'item-1',
        revision: 1,
        job_input_revision: 0,
        eligible: null,
        score: null,
        tier: null,
        breakdown: null,
        filter_code: null,
        filter_detail: null,
        best_fit_resume_id: null,
        runner_up_resume_id: null,
        error_code: 'ranking_item_failed',
      }],
    })
  })

  it('rejects a partially acknowledged batch without finalizing', async () => {
    const { client, operations } = runtime({ stagedCount: 0 })

    await expect(
      runDeterministicWorker({ client, ...deadlineOptions }),
    ).rejects.toThrow('ranking_stage_incomplete')

    expect(
      operations.filter((operation) =>
        operation.name === 'stage_deterministic_ranking_results'
      ),
    ).toHaveLength(1)
    expect(
      operations.some((operation) =>
        operation.name === 'finalize_deterministic_ranking_run'
      ),
    ).toBe(false)
  })

  it('binds every ordinary network operation to one invocation signal', async () => {
    const { client, operations } = runtime()

    const result = await runDeterministicWorker({ client, ...deadlineOptions })

    expect(result).toMatchObject({
      claimed: 1,
      completed: 1,
      failed: 0,
      finalized: 1,
      automatic_ai_scoring: false,
    })
    expect(operations.length).toBeGreaterThan(4)
    expect(operations.every((operation) => operation.signal)).toBe(true)
    expect(new Set(operations.map((operation) => operation.signal)).size).toBe(1)
  })

  it('aborts a never-resolving job load without staging or publishing', async () => {
    const { client, operations } = runtime({ hangTable: 'jobs' })
    const startedAt = performance.now()

    await expect(
      runDeterministicWorker({ client, ...deadlineOptions }),
    ).rejects.toBeInstanceOf(DeterministicWorkerDeadlineError)

    expect(performance.now() - startedAt).toBeLessThan(150)
    expect(
      operations.some((operation) =>
        operation.name === 'stage_deterministic_ranking_results'
      ),
    ).toBe(false)
    expect(
      operations.some((operation) =>
        operation.name === 'finalize_deterministic_ranking_run'
      ),
    ).toBe(false)
  })

  it('aborts a never-resolving stage and leaves the claim lease-reclaimable', async () => {
    const { client, operations } = runtime({
      hangRpc: 'stage_deterministic_ranking_results',
    })

    await expect(
      runDeterministicWorker({ client, ...deadlineOptions }),
    ).rejects.toBeInstanceOf(DeterministicWorkerDeadlineError)

    expect(
      operations.filter((operation) =>
        operation.name === 'stage_deterministic_ranking_results'
      ),
    ).toHaveLength(1)
    expect(
      operations.some((operation) =>
        operation.name === 'finalize_deterministic_ranking_run'
      ),
    ).toBe(false)
  })

  it('aborts a never-resolving finalizer without fabricating publication', async () => {
    const { client, operations } = runtime({
      hangRpc: 'finalize_deterministic_ranking_run',
    })

    await expect(
      runDeterministicWorker({ client, ...deadlineOptions }),
    ).rejects.toBeInstanceOf(DeterministicWorkerDeadlineError)

    expect(
      operations.filter((operation) =>
        operation.name === 'finalize_deterministic_ranking_run'
      ),
    ).toHaveLength(1)
  })
})

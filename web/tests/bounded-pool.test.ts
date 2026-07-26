import { describe, expect, it } from 'vitest'
import {
  BoundedPoolDeadlineError,
  DEFAULT_BRANDED_COMPANY_CONCURRENCY,
  DEFAULT_BRANDED_DETAIL_CONCURRENCY,
  DEFAULT_BRANDED_PAGE_CAP,
  DEFAULT_BRANDED_PAGE_CONCURRENCY,
  DEFAULT_BRANDED_STOP_SCHEDULING_MS,
  runBoundedPool,
} from '../../supabase/functions/_shared/bounded-pool'

describe('bounded worker pool', () => {
  it('pins the server-side Phase 03.8 operational defaults', () => {
    expect({
      companyConcurrency: DEFAULT_BRANDED_COMPANY_CONCURRENCY,
      pageConcurrency: DEFAULT_BRANDED_PAGE_CONCURRENCY,
      detailConcurrency: DEFAULT_BRANDED_DETAIL_CONCURRENCY,
      pageCap: DEFAULT_BRANDED_PAGE_CAP,
      stopSchedulingMs: DEFAULT_BRANDED_STOP_SCHEDULING_MS,
    }).toEqual({
      companyConcurrency: 2,
      pageConcurrency: 2,
      detailConcurrency: 4,
      pageCap: 100,
      stopSchedulingMs: 120_000,
    })
  })

  it.each([1, 2, 4])(
    'never exceeds configured concurrency %s and preserves input order',
    async (concurrency) => {
      let active = 0
      let peak = 0
      const outcomes = await runBoundedPool(
        [5, 4, 3, 2, 1],
        async (item) => {
          active += 1
          peak = Math.max(peak, active)
          await new Promise<void>((resolve) => queueMicrotask(resolve))
          active -= 1
          return item * 10
        },
        {
          concurrency,
          deadlineMs: 1_000,
        },
      )

      expect(peak).toBeLessThanOrEqual(concurrency)
      expect(outcomes).toEqual([
        { status: 'fulfilled', value: 50 },
        { status: 'fulfilled', value: 40 },
        { status: 'fulfilled', value: 30 },
        { status: 'fulfilled', value: 20 },
        { status: 'fulfilled', value: 10 },
      ])
    },
  )

  it('captures one operation failure without cancelling unrelated work', async () => {
    const completed: number[] = []
    const outcomes = await runBoundedPool(
      [1, 2, 3, 4],
      async (item) => {
        if (item === 2) throw new Error('item-local')
        completed.push(item)
        return item
      },
      {
        concurrency: 2,
        deadlineMs: 1_000,
      },
    )

    expect(completed.sort()).toEqual([1, 3, 4])
    expect(outcomes[0]).toEqual({ status: 'fulfilled', value: 1 })
    expect(outcomes[1]).toMatchObject({ status: 'rejected' })
    expect(outcomes[2]).toEqual({ status: 'fulfilled', value: 3 })
    expect(outcomes[3]).toEqual({ status: 'fulfilled', value: 4 })
  })

  it('uses one shared signal, aborts outstanding work, and reports a typed deadline', async () => {
    let deadlineCallback: (() => void) | undefined
    const started: number[] = []
    const signals: AbortSignal[] = []
    const aborted: number[] = []

    const running = runBoundedPool(
      [1, 2, 3, 4],
      (item, _index, signal) => {
        started.push(item)
        signals.push(signal)
        return new Promise<number>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted.push(item)
            reject(new DOMException('aborted', 'AbortError'))
          }, { once: true })
        })
      },
      {
        concurrency: 2,
        deadlineMs: 50,
        now: () => 0,
        scheduleTimeout: (callback) => {
          deadlineCallback = callback
          return 1
        },
        cancelTimeout: () => {},
      },
    )

    await Promise.resolve()
    expect(started).toEqual([1, 2])
    deadlineCallback?.()

    const error = await running.catch((reason) => reason)
    expect(error).toBeInstanceOf(BoundedPoolDeadlineError)
    expect(error).toMatchObject({
      code: 'bounded_pool_deadline',
      startedCount: 2,
    })
    expect(started).toEqual([1, 2])
    expect(signals[0]).toBe(signals[1])
    expect(signals[0].aborted).toBe(true)
    expect(aborted.sort()).toEqual([1, 2])
  })

  it('checks the monotonic deadline before scheduling the next item', async () => {
    let clock = 0
    const started: number[] = []
    const running = runBoundedPool(
      [1, 2, 3],
      async (item) => {
        started.push(item)
        clock = 5
        return item
      },
      {
        concurrency: 1,
        deadlineMs: 5,
        now: () => clock,
        scheduleTimeout: () => 1,
        cancelTimeout: () => {},
      },
    )

    await expect(running).rejects.toMatchObject({
      name: 'BoundedPoolDeadlineError',
      startedCount: 1,
    })
    expect(started).toEqual([1])
  })

  it.each([
    { concurrency: 0, deadlineMs: 1_000 },
    { concurrency: 1.5, deadlineMs: 1_000 },
    { concurrency: 1, deadlineMs: 0 },
    { concurrency: 1, deadlineMs: Number.POSITIVE_INFINITY },
  ])('rejects invalid internal bounds %#', async (options) => {
    await expect(runBoundedPool([], async () => true, options)).rejects.toThrow(
      'invalid_bounded_pool_options',
    )
  })
})

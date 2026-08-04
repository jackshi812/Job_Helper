import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppQueryClient } from './queryClient'

describe('createAppQueryClient', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs one fixed-delay automatic retry and lets an explicit fetch start a fresh cycle', async () => {
    vi.useFakeTimers()
    const queryClient = createAppQueryClient()
    const failure = new Error('query failed')
    const queryFn = vi.fn().mockRejectedValue(failure)
    const query = {
      queryKey: ['bounded-query-retry'] as const,
      queryFn,
    }

    const firstCycle = queryClient.fetchQuery(query)
    const firstFailure = expect(firstCycle).rejects.toBe(failure)
    await vi.advanceTimersByTimeAsync(999)
    expect(queryFn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await firstFailure
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(queryClient.getQueryState(query.queryKey)?.error).toBe(failure)
    await vi.runAllTimersAsync()
    expect(queryFn).toHaveBeenCalledTimes(2)

    const explicitCycle = queryClient.fetchQuery(query)
    const explicitFailure = expect(explicitCycle).rejects.toBe(failure)
    expect(queryFn).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1_000)
    await explicitFailure
    expect(queryFn).toHaveBeenCalledTimes(4)
    await vi.runAllTimersAsync()
    expect(queryFn).toHaveBeenCalledTimes(4)

    queryClient.clear()
  })

  it('leaves failing mutations at the TanStack single-attempt default', async () => {
    const queryClient = createAppQueryClient()
    const failure = new Error('mutation failed')
    const mutationFn = vi.fn().mockRejectedValue(failure)
    const mutation = queryClient.getMutationCache().build(queryClient, { mutationFn })

    await expect(mutation.execute(undefined)).rejects.toBe(failure)
    expect(mutationFn).toHaveBeenCalledTimes(1)

    queryClient.clear()
  })
})

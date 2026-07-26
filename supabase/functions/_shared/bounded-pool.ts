export const DEFAULT_BRANDED_COMPANY_CONCURRENCY = 2
export const DEFAULT_BRANDED_PAGE_CONCURRENCY = 2
export const DEFAULT_BRANDED_DETAIL_CONCURRENCY = 4
export const DEFAULT_BRANDED_PAGE_CAP = 100
export const DEFAULT_BRANDED_STOP_SCHEDULING_MS = 120_000

export interface BoundedPoolOptions {
  concurrency: number
  deadlineMs?: number
  now?: () => number
  scheduleTimeout?: (callback: () => void, delayMs: number) => unknown
  cancelTimeout?: (handle: unknown) => void
}

export interface IndexedBoundedPoolOutcome {
  readonly index: number
  readonly outcome: PromiseSettledResult<unknown>
}

export class BoundedPoolDeadlineError extends Error {
  readonly code = 'bounded_pool_deadline'
  readonly startedCount: number
  readonly outcomes: readonly IndexedBoundedPoolOutcome[]

  constructor(
    startedCount = 0,
    outcomes: readonly IndexedBoundedPoolOutcome[] = [],
  ) {
    super('bounded_pool_deadline')
    this.name = 'BoundedPoolDeadlineError'
    this.startedCount = startedCount
    this.outcomes = Object.freeze([...outcomes])
  }
}

class DeadlineSignalError extends Error {
  constructor() {
    super('bounded_pool_deadline_signal')
    this.name = 'DeadlineSignalError'
  }
}

function validateOptions(options: BoundedPoolOptions): number {
  const deadlineMs =
    options.deadlineMs ?? DEFAULT_BRANDED_STOP_SCHEDULING_MS
  if (
    !Number.isInteger(options.concurrency)
    || options.concurrency <= 0
    || !Number.isFinite(deadlineMs)
    || deadlineMs <= 0
  ) {
    throw new Error('invalid_bounded_pool_options')
  }
  return deadlineMs
}

function awaitWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(new DeadlineSignalError())

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DeadlineSignalError())
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort)
    })
  })
}

/**
 * Runs item operations with deterministic output ordering and one shared
 * deadline/abort signal. Ordinary item failures are captured in place; reaching
 * the shared deadline stops new scheduling and rejects with a typed error that
 * retains all outcomes settled before the deadline.
 */
export async function runBoundedPool<Input, Output>(
  inputs: readonly Input[],
  worker: (
    input: Input,
    index: number,
    signal: AbortSignal,
  ) => Promise<Output>,
  options: BoundedPoolOptions,
): Promise<PromiseSettledResult<Output>[]> {
  const deadlineMs = validateOptions(options)
  if (inputs.length === 0) return []

  const now = options.now ?? (() => performance.now())
  const scheduleTimeout = options.scheduleTimeout
    ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs))
  const cancelTimeout = options.cancelTimeout
    ?? ((handle) => globalThis.clearTimeout(handle as number))
  const startedAt = now()
  if (!Number.isFinite(startedAt)) throw new Error('invalid_bounded_pool_clock')
  const deadlineAt = startedAt + deadlineMs
  const controller = new AbortController()
  const outcomes: Array<PromiseSettledResult<Output> | undefined> =
    new Array(inputs.length)
  let nextIndex = 0
  let startedCount = 0
  let deadlineReached = false

  const expire = () => {
    if (deadlineReached) return
    deadlineReached = true
    controller.abort(new DeadlineSignalError())
  }
  const timeout = scheduleTimeout(expire, Math.max(0, deadlineAt - now()))

  const runWorker = async () => {
    while (!controller.signal.aborted) {
      if (now() >= deadlineAt) {
        expire()
        return
      }

      const index = nextIndex
      if (index >= inputs.length) return
      nextIndex += 1
      startedCount += 1

      try {
        const operation = Promise.resolve().then(() =>
          worker(inputs[index], index, controller.signal)
        )
        const value = await awaitWithAbort(operation, controller.signal)
        outcomes[index] = { status: 'fulfilled', value }
      } catch (reason) {
        if (controller.signal.aborted || reason instanceof DeadlineSignalError) {
          return
        }
        outcomes[index] = { status: 'rejected', reason }
      }
    }
  }

  try {
    const workerCount = Math.min(options.concurrency, inputs.length)
    await Promise.all(Array.from({ length: workerCount }, runWorker))
  } finally {
    cancelTimeout(timeout)
  }

  if (deadlineReached || controller.signal.aborted) {
    const settled = outcomes.flatMap((outcome, index) =>
      outcome ? [{ index, outcome: outcome as PromiseSettledResult<unknown> }] : []
    )
    throw new BoundedPoolDeadlineError(startedCount, settled)
  }

  return outcomes as PromiseSettledResult<Output>[]
}

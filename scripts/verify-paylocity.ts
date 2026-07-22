import { pathToFileURL } from 'node:url'

export const PAYLOCITY_BOARD_UUID = 'd6628b21-949b-4400-a3d0-c9082bbf3eb1'
export const PAYLOCITY_SOURCE_KEY = `paylocity:global:${PAYLOCITY_BOARD_UUID}`
export const PAYLOCITY_MUTATION_CLASSES = Object.freeze([])
export const PAYLOCITY_FAILURE_STAGES = Object.freeze([])

export interface PaylocityVerificationAdapters {
  [key: string]: unknown
}

export async function collectPaylocitySnapshotRows<T>(
  _fetchPage: (from: number, to: number) => Promise<{ rows: T[]; count: number | null }>,
): Promise<T[]> {
  throw new Error('not implemented')
}

export function redactPaylocityEvidence(_value: unknown): unknown {
  throw new Error('not implemented')
}

export async function runPaylocityVerification(
  _adapters: PaylocityVerificationAdapters,
): Promise<unknown> {
  throw new Error('not implemented')
}

export async function run(_argv = process.argv.slice(2)): Promise<void> {
  throw new Error('not implemented')
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Paylocity verification failed')
    process.exitCode = 1
  })
}

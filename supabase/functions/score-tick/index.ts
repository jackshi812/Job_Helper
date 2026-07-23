import { createClient } from 'npm:@supabase/supabase-js@2.110.7'
import {
  runDeterministicWorker,
  type DeterministicWorkerClient,
} from '../_shared/deterministic-worker.ts'

// Free deterministic ranking worker. The every-minute scheduler and its
// x-cron-secret boundary remain unchanged, while the shared production loop
// bounds every database/RPC await under one invocation AbortSignal.

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function diagnosticCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/timeout|timed out|abort|deadline/i.test(message)) return 'ranking_timeout'
  return 'ranking_item_failed'
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret || request.headers.get('x-cron-secret') !== cronSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createClient(
      requiredEnvironment('SUPABASE_URL'),
      requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      },
    )
    const result = await runDeterministicWorker({
      client: admin as unknown as DeterministicWorkerClient,
    })
    return Response.json(result)
  } catch (error) {
    console.error('score-tick failed', diagnosticCode(error))
    return Response.json(
      { error: 'Deterministic ranking tick failed' },
      { status: 500 },
    )
  }
})

import { createClient } from 'npm:@supabase/supabase-js@2.110.7'

const STALE_AFTER_MS = 30 * 60_000

Deno.serve(async (request) => {
  if (request.method !== 'GET') {
    return new Response('method not allowed', {
      status: 405,
      headers: { Allow: 'GET' },
    })
  }

  const heartbeatSecret = Deno.env.get('HEARTBEAT_SECRET')
  const providedSecret = new URL(request.url).searchParams.get('k')

  if (!heartbeatSecret || providedSecret !== heartbeatSecret) {
    return new Response('unauthorized', { status: 401 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response('stale', { status: 503 })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await admin
    .from('pipeline_heartbeat')
    .select('last_success_at')
    .eq('id', true)
    .maybeSingle()

  const successTime = data?.last_success_at
    ? new Date(data.last_success_at).getTime()
    : Number.NaN
  const fresh = !error
    && Number.isFinite(successTime)
    && Date.now() - successTime < STALE_AFTER_MS

  return new Response(fresh ? 'ok' : 'stale', { status: fresh ? 200 : 503 })
})

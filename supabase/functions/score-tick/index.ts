// Phase 03.4 containment endpoint.
//
// Keep the deployed scheduler and its handler-level shared-secret boundary
// compatible while automatic job ranking is replaced. This endpoint
// intentionally creates no privileged client, claims no work, and performs no
// persistence or external request.
Deno.serve((request) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret || request.headers.get('x-cron-secret') !== cronSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return Response.json({
    status: 'contained',
    automatic_job_scoring: false,
    mutations: 0,
  })
})

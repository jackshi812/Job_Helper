import {
  buildEndpoint,
  detectAts,
  type DetectResult,
  UNSUPPORTED_URL_MESSAGE,
} from '../_shared/detect.ts'

const VERIFICATION_FAILED_MESSAGE =
  "We couldn't verify this board — it may not exist or the URL may be misspelled. Check the address and try again."

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Origin': '*',
}

type GreenhouseResponse = {
  jobs?: Array<{ company_name?: string }>
}

type AshbyResponse = {
  jobs?: Array<{ isListed?: boolean }>
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders })
}

function successfulResponse(
  detected: Exclude<DetectResult, { ats: 'unsupported' }>,
  payload: unknown,
) {
  let companyName = detected.slug
  let jobCount: number

  if (detected.ats === 'greenhouse') {
    const jobs = (payload as GreenhouseResponse).jobs
    if (!Array.isArray(jobs)) throw new Error('Unexpected Greenhouse response')
    companyName = jobs[0]?.company_name?.trim() || detected.slug
    jobCount = jobs.length
  } else if (detected.ats === 'lever') {
    if (!Array.isArray(payload)) throw new Error('Unexpected Lever response')
    jobCount = payload.length
  } else {
    const jobs = (payload as AshbyResponse).jobs
    if (!Array.isArray(jobs)) throw new Error('Unexpected Ashby response')
    jobCount = jobs.filter((job) => job.isListed === true).length
  }

  return {
    ok: true,
    ats: detected.ats,
    board_token: detected.slug,
    region: detected.region ?? null,
    company_name: companyName,
    job_count: jobCount,
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') {
    return json({ ok: false, reason: 'error', message: 'Method not allowed.' }, 405)
  }

  try {
    const body = await request.json() as { url?: unknown }
    const detected = detectAts(typeof body.url === 'string' ? body.url : '')

    if (detected.ats === 'unsupported') {
      return json({ ok: false, reason: 'unsupported', message: UNSUPPORTED_URL_MESSAGE })
    }

    const res = await fetch(buildEndpoint(detected))
    if (!res.ok) {
      return json({
        ok: false,
        reason: res.status === 404 ? 'not_found' : 'error',
        message: VERIFICATION_FAILED_MESSAGE,
      })
    }

    return json(successfulResponse(detected, await res.json()))
  } catch (error) {
    console.error('verify-board failed', error)
    return json({ ok: false, reason: 'error', message: VERIFICATION_FAILED_MESSAGE })
  }
})

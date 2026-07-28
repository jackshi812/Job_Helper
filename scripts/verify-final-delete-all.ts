#!/usr/bin/env node

import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createClient } from '../web/node_modules/@supabase/supabase-js/dist/index.mjs'

const required = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
] as const

const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const RUBRIC = {
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
}

type Client = ReturnType<typeof createClient>

function fail(message: string): never {
  throw new Error(`FAIL: ${message}`)
}

function pass(message: string) {
  console.log(`PASS: ${message}`)
}

function requireEnvironment() {
  for (const name of required) {
    if (!process.env[name]) fail(`missing required environment variable: ${name}`)
  }
  return {
    url: process.env.SUPABASE_URL!,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY!,
    secretKey: process.env.SUPABASE_SECRET_KEY!,
  }
}

function isolatedClient(url: string, key: string) {
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })
}

async function requireNoError(
  operation: PromiseLike<{ error: unknown }>,
  label: string,
) {
  const { error } = await operation
  if (error) fail(label)
  pass(label)
}

async function ownerCount(admin: Client, table: string, userId: string) {
  const { count, error } = await admin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (error || count === null) fail(`could not count ${table}`)
  return count
}

export async function runFinalDeleteAllVerification() {
  const environment = requireEnvironment()
  const admin = isolatedClient(environment.url, environment.secretKey)
  const user = isolatedClient(environment.url, environment.publishableKey)
  const nonce = `${Date.now()}-${randomBytes(6).toString('hex')}`
  const email = `phase-0059-delete-${nonce}@example.invalid`
  const password = `V1!${randomBytes(24).toString('base64url')}`
  let userId: string | null = null
  let storagePath: string | null = null

  try {
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
    if (createError || !created.user) fail('could not create disposable user')
    userId = created.user.id
    pass('created disposable cleanup user')

    const { error: signInError } = await user.auth.signInWithPassword({
      email,
      password,
    })
    if (signInError) fail('disposable user could not authenticate')
    pass('authenticated disposable cleanup user')

    const { data: selectedJob, error: jobError } = await admin
      .from('jobs')
      .select('id')
      .limit(1)
      .single()
    if (jobError || !selectedJob?.id) fail('shared job fixture parent is unavailable')
    const jobId = String(selectedJob.id)

    storagePath = `${userId}/phase-0059-delete-${nonce}.docx`
    const storageBody = new Blob(['phase-0059-delete'], {
      type: DOCX_CONTENT_TYPE,
    })
    const { error: uploadError } = await user.storage
      .from('resumes')
      .upload(storagePath, storageBody, {
        contentType: DOCX_CONTENT_TYPE,
        upsert: false,
      })
    if (uploadError) fail('could not upload disposable resume object')
    pass('seeded disposable resume storage object')

    const { data: resume, error: resumeError } = await user
      .from('resumes')
      .insert({
        filename: 'phase-0059-delete.docx',
        storage_path: storagePath,
        size_bytes: storageBody.size,
      })
      .select('id')
      .single()
    if (resumeError || !resume?.id) fail('could not seed disposable resume row')
    const resumeId = String(resume.id)

    await requireNoError(
      admin.from('resume_extracts').insert({
        resume_id: resumeId,
        user_id: userId,
      }),
      'seeded resume extract',
    )
    await requireNoError(
      admin.from('preferences').insert({ user_id: userId }),
      'seeded preferences',
    )
    await requireNoError(
      admin.from('ai_usage').insert({
        purpose: 'extract',
        model: 'phase-0059-delete-probe',
        prompt_tokens: 0,
        output_tokens: 0,
        user_id: userId,
      }),
      'seeded user-attributed usage',
    )
    await requireNoError(
      admin.from('user_job_dismissals').insert({
        user_id: userId,
        source: 'phase-0059-delete-probe',
        external_id: nonce,
      }),
      'seeded dismissal tombstone',
    )

    const { data: userJob, error: userJobError } = await admin
      .from('user_jobs')
      .upsert(
        { user_id: userId, job_id: jobId },
        { onConflict: 'user_id,job_id' },
      )
      .select('id')
      .single()
    if (userJobError || !userJob?.id) fail('could not seed user job')
    const userJobId = String(userJob.id)
    pass('seeded user job')

    const { data: rankingRun, error: rankingRunError } = await admin
      .from('deterministic_ranking_runs')
      .insert({
        user_id: userId,
        revision: 1,
        run_kind: 'initial',
        is_initial: true,
        captured_titles: [],
        captured_locations: [],
        captured_include_keywords: [],
        captured_exclude_keywords: [],
        captured_title_exclude_keywords: [],
        captured_max_required_experience: null,
        captured_rubric: RUBRIC,
        captured_good_threshold: 50,
        captured_strong_threshold: 75,
        evaluation_time: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (rankingRunError || !rankingRun?.id) fail('could not seed ranking run')
    const rankingRunId = String(rankingRun.id)
    pass('seeded ranking run')

    await requireNoError(
      admin.from('deterministic_ranking_state').upsert({
        user_id: userId,
      }),
      'seeded ranking state',
    )
    await requireNoError(
      admin.from('deterministic_ranking_items').insert({
        run_id: rankingRunId,
        user_id: userId,
        user_job_id: userJobId,
        job_id: jobId,
        revision: 1,
      }),
      'seeded ranking item',
    )

    const { data: application, error: applicationError } = await user.rpc(
      'create_manual_application',
      {
        p_company: 'Phase 0059 Cleanup Probe',
        p_title: 'Disposable Application',
        p_apply_url: 'https://example.com/phase-0059-cleanup',
        p_notes: 'delete-all verifier',
        p_stage: 'ready_to_apply',
        p_occurred_on: new Date().toISOString().slice(0, 10),
      },
    )
    if (
      applicationError
      || !Array.isArray(application)
      || application.length !== 1
    ) {
      fail('could not seed application and required timeline event')
    }
    pass('seeded application and required timeline event')

    const seededTables = [
      'applications',
      'application_stage_events',
      'user_job_dismissals',
      'deterministic_ranking_state',
      'deterministic_ranking_runs',
      'deterministic_ranking_items',
      'ai_usage',
      'resume_extracts',
      'resumes',
      'preferences',
      'user_jobs',
    ]
    for (const table of seededTables) {
      if (await ownerCount(admin, table, userId) < 1) {
        fail(`${table} fixture is missing before delete-all`)
      }
    }
    pass('all final-schema personal relations contain owner fixtures')

    const { data: removed, error: removeError } = await user.storage
      .from('resumes')
      .remove([storagePath])
    if (removeError || removed?.length !== 1) {
      fail('storage-first removal did not remove exactly one object')
    }
    pass('removed exact disposable storage object before database cleanup')

    const { error: deleteError } = await user.rpc('delete_my_data')
    if (deleteError) fail('delete_my_data rejected final-schema fixtures')
    pass('delete_my_data accepted tracker and ranking fixtures')

    for (const table of seededTables) {
      if (await ownerCount(admin, table, userId) !== 0) {
        fail(`${table} retained owner rows after delete-all`)
      }
    }
    pass('all final-schema personal relations are empty')

    const { count: profileCount, error: profileError } = await admin
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('id', userId)
    if (profileError || profileCount !== 1) {
      fail('delete-all did not retain exactly one owner profile')
    }
    const { data: retainedAuth, error: retainedAuthError } =
      await admin.auth.admin.getUserById(userId)
    if (retainedAuthError || retainedAuth.user?.id !== userId) {
      fail('delete-all did not retain the login')
    }
    pass('login and profile remain after personal-data cleanup')
  } finally {
    const cleanupErrors: string[] = []
    if (storagePath) {
      const { error } = await admin.storage.from('resumes').remove([storagePath])
      if (error) cleanupErrors.push('disposable storage object')
    }
    await user.auth.signOut()
    if (userId) {
      const { error } = await admin.auth.admin.deleteUser(userId)
      if (error) cleanupErrors.push('disposable verifier user')
      else pass('removed disposable verifier user')
    }
    if (cleanupErrors.length > 0) {
      fail(`could not remove ${cleanupErrors.join(' and ')}`)
    }
  }
}

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  runFinalDeleteAllVerification().catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'FAIL: delete-all verification failed',
    )
    process.exitCode = 1
  })
}

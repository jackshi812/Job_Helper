import { pathToFileURL } from 'node:url'
import { createClient } from '../web/node_modules/@supabase/supabase-js/dist/index.mjs'

const required = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'USER1_EMAIL',
  'USER2_EMAIL',
  'SEED_PASSWORD_1',
  'SEED_PASSWORD_2',
] as const

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const sanitizedFetch: typeof fetch = async (input, init) => {
  try {
    return await globalThis.fetch(input, init)
  } catch {
    throw new Error('Supabase network request failed')
  }
}

export function assertIsolation(condition: boolean, label: string): asserts condition {
  if (!condition) throw new Error(`CROSS-USER LEAK: ${label}`)
}

function requiredEnvironment() {
  for (const name of required) {
    if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`)
  }

  return {
    url: process.env.SUPABASE_URL!,
    key: process.env.SUPABASE_PUBLISHABLE_KEY!,
    user1: { email: process.env.USER1_EMAIL!, password: process.env.SEED_PASSWORD_1! },
    user2: { email: process.env.USER2_EMAIL!, password: process.env.SEED_PASSWORD_2! },
  }
}

function createProbeClient(url: string, key: string) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: sanitizedFetch },
  })
}

export async function runRlsVerification() {
  const environment = requiredEnvironment()
  const clientA = createProbeClient(environment.url, environment.key)
  const clientB = createProbeClient(environment.url, environment.key)
  const failures: string[] = []

  function probe(condition: boolean, label: string) {
    try {
      assertIsolation(condition, label)
      console.log(`PASS: ${label}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : `CROSS-USER LEAK: ${label}`
      console.error(message)
      failures.push(message)
    }
  }

  function cleanup(condition: boolean, label: string) {
    if (condition) {
      console.log(`PASS: ${label}`)
      return
    }
    const message = `PROBE CLEANUP FAILED: ${label}`
    console.error(message)
    failures.push(message)
  }

  let probeRowId: string | undefined
  let probePath: string | undefined
  let intruderPath: string | undefined
  let probeObjectUploaded = false
  let intruderObjectUploaded = false
  let uidA = ''
  let uidB = ''

  try {
    const [{ data: authA, error: authErrorA }, { data: authB, error: authErrorB }] = await Promise.all([
      clientA.auth.signInWithPassword(environment.user1),
      clientB.auth.signInWithPassword(environment.user2),
    ])

    if (authErrorA || !authA.user) throw new Error('User A authentication failed')
    if (authErrorB || !authB.user) throw new Error('User B authentication failed')
    uidA = authA.user.id
    uidB = authB.user.id
    console.log('PASS: both independent publishable-key clients authenticated')

    const stamp = Date.now()
    probePath = `${uidA}/rls-probe-${stamp}.docx`
    intruderPath = `${uidA}/intruder-${stamp}.docx`

    const { data: inserted, error: insertError } = await clientA
      .from('resumes')
      .insert({ filename: 'rls-probe.docx', storage_path: probePath, size_bytes: 9 })
      .select('id, user_id')
      .single()
    if (insertError || !inserted) throw new Error('Unable to create the RLS probe row')
    probeRowId = inserted.id
    probe(inserted.user_id === uidA, 'User A created a resume row owned by User A')

    const probeBlob = new Blob(['rls-probe'], { type: DOCX_CONTENT_TYPE })
    const { error: probeUploadError } = await clientA.storage.from('resumes').upload(probePath, probeBlob, {
      contentType: DOCX_CONTENT_TYPE,
      upsert: false,
    })
    if (probeUploadError) throw new Error('Unable to upload the RLS probe object')
    probeObjectUploaded = true
    console.log('PASS: User A uploaded a probe object to their own folder')

    const { data: visibleRows, error: visibleRowsError } = await clientB.from('resumes').select('*')
    probe(!visibleRowsError && visibleRows?.length === 0, 'User B unfiltered resumes select returned zero rows')

    const { data: targetedRead, error: targetedReadError } = await clientB
      .from('resumes')
      .select('id')
      .eq('id', probeRowId)
    probe(!targetedReadError && targetedRead?.length === 0, 'User B targeted resume select affected zero rows')

    const { data: targetedUpdate, error: targetedUpdateError } = await clientB
      .from('resumes')
      .update({ filename: 'intruder.docx' })
      .eq('id', probeRowId)
      .select('id')
    probe(!targetedUpdateError && targetedUpdate?.length === 0, 'User B targeted resume update affected zero rows')

    const { data: targetedDelete, error: targetedDeleteError } = await clientB
      .from('resumes')
      .delete()
      .eq('id', probeRowId)
      .select('id')
    probe(!targetedDeleteError && targetedDelete?.length === 0, 'User B targeted resume delete affected zero rows')

    const { data: reparented, error: reparentError } = await clientA
      .from('resumes')
      .update({ user_id: uidB })
      .eq('id', probeRowId)
      .select('id')
    probe(Boolean(reparentError) || reparented?.length === 0, 'User A could not re-parent a resume row to User B')

    const { data: foreignDownload, error: foreignDownloadError } = await clientB.storage
      .from('resumes')
      .download(probePath)
    probe(Boolean(foreignDownloadError) && !foreignDownload, 'User B could not download User A storage object')

    const { data: foreignList, error: foreignListError } = await clientB.storage.from('resumes').list(uidA)
    probe(!foreignListError && foreignList?.length === 0, 'User B listing User A folder returned zero objects')

    const { error: foreignUploadError } = await clientB.storage.from('resumes').upload(intruderPath, probeBlob, {
      contentType: DOCX_CONTENT_TYPE,
      upsert: false,
    })
    intruderObjectUploaded = !foreignUploadError
    probe(Boolean(foreignUploadError), 'User B could not upload into User A storage folder')

    const { data: visibleProfiles, error: profilesSelectError } = await clientB.from('profiles').select('id')
    probe(
      !profilesSelectError && visibleProfiles?.length === 1 && visibleProfiles[0]?.id === uidB,
      'User B unfiltered profiles select returned only User B profile',
    )

    const { data: profileUpdate, error: profileUpdateError } = await clientB
      .from('profiles')
      .update({ email: 'intruder@example.com' })
      .eq('id', uidA)
      .select('id')
    probe(
      Boolean(profileUpdateError) || profileUpdate?.length === 0,
      'User B targeted update of User A profile affected zero rows',
    )
  } finally {
    if (intruderObjectUploaded && intruderPath) {
      const { data, error } = await clientA.storage.from('resumes').remove([intruderPath])
      cleanup(!error && data.some((item) => item.name === intruderPath), 'User A removed the unexpected intruder object')
    }

    if (probeObjectUploaded && probePath) {
      const { data, error } = await clientA.storage.from('resumes').remove([probePath])
      cleanup(!error && data.some((item) => item.name === probePath), 'User A removed the probe storage object')
    }

    if (probeRowId) {
      const { data: deletedByA, error: deleteErrorA } = await clientA
        .from('resumes')
        .delete()
        .eq('id', probeRowId)
        .select('id')
      let deleted = !deleteErrorA && deletedByA?.length === 1

      if (!deleted) {
        const { data: deletedByB, error: deleteErrorB } = await clientB
          .from('resumes')
          .delete()
          .eq('id', probeRowId)
          .select('id')
        deleted = !deleteErrorB && deletedByB?.length === 1
      }
      cleanup(deleted, 'probe resume row was deleted')
    }

    await Promise.all([clientA.auth.signOut(), clientB.auth.signOut()])
  }

  if (failures.length > 0) throw new Error(`${failures.length} RLS verification probe(s) failed`)
  console.log('PASS: all CROSS-USER isolation probes completed with zero leaks')
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  runRlsVerification().catch((error) => {
    console.error(error instanceof Error ? error.message : 'RLS verification failed')
    process.exitCode = 1
  })
}

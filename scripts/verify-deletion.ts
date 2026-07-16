import { pathToFileURL } from 'node:url'
import { createClient } from '../web/node_modules/@supabase/supabase-js/dist/index.mjs'

const required = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'USER1_EMAIL',
  'SEED_PASSWORD_1',
] as const

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const STORAGE_PAGE_SIZE = 1000
const STORAGE_REMOVE_BATCH_SIZE = 100

const sanitizedFetch: typeof fetch = async (input, init) => {
  try {
    return await globalThis.fetch(input, init)
  } catch {
    throw new Error('Supabase network request failed')
  }
}

function requiredEnvironment() {
  for (const name of required) {
    if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`)
  }

  return {
    url: process.env.SUPABASE_URL!,
    key: process.env.SUPABASE_PUBLISHABLE_KEY!,
    email: process.env.USER1_EMAIL!,
    password: process.env.SEED_PASSWORD_1!,
    confirmWipe: process.env.CONFIRM_WIPE === 'yes',
  }
}

function pass(label: string) {
  console.log(`PASS: ${label}`)
}

function assertStep(condition: boolean, label: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${label}`)
  pass(label)
}

async function listAllStoragePaths(client: ReturnType<typeof createClient>, userId: string) {
  const bucket = client.storage.from('resumes')
  const paths: string[] = []

  for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
    const { data, error } = await bucket.list(userId, {
      limit: STORAGE_PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    })
    if (error) throw new Error('FAIL: could not list resume storage objects')

    const objects = data ?? []
    paths.push(...objects.map((object) => `${userId}/${object.name}`))
    if (objects.length < STORAGE_PAGE_SIZE) break
  }

  return paths
}

async function removeAllStoragePaths(client: ReturnType<typeof createClient>, paths: string[]) {
  const bucket = client.storage.from('resumes')
  let removedCount = 0

  for (let index = 0; index < paths.length; index += STORAGE_REMOVE_BATCH_SIZE) {
    const batch = paths.slice(index, index + STORAGE_REMOVE_BATCH_SIZE)
    const { data: removed, error } = await bucket.remove(batch)
    if (error || removed?.length !== batch.length) {
      throw new Error('FAIL: storage delete incomplete; database rows were kept')
    }
    removedCount += removed.length
  }

  assertStep(removedCount === paths.length, 'removed every listed storage object')
}

export async function runDeletionVerification() {
  const environment = requiredEnvironment()
  const client = createClient(environment.url, environment.key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: sanitizedFetch },
  })

  try {
    const { data: auth, error: authError } = await client.auth.signInWithPassword({
      email: environment.email,
      password: environment.password,
    })
    assertStep(!authError && Boolean(auth.user), 'User 1 authenticated with the publishable key')
    const userId = auth.user!.id

    const [{ data: existingRows, error: rowsError }, existingPaths] = await Promise.all([
      client.from('resumes').select('id'),
      listAllStoragePaths(client, userId),
    ])
    if (rowsError) throw new Error('FAIL: could not inspect existing resume rows')

    const existingRowCount = existingRows?.length ?? 0
    if ((existingRowCount > 0 || existingPaths.length > 0) && !environment.confirmWipe) {
      throw new Error(
        `FAIL: destructive preflight found ${existingRowCount} existing resume row(s) and ${existingPaths.length} existing storage object(s); set CONFIRM_WIPE=yes only after confirming they may be erased`,
      )
    }
    pass(
      existingRowCount === 0 && existingPaths.length === 0
        ? 'destructive preflight found no existing User 1 resume data'
        : 'destructive preflight wipe was explicitly confirmed',
    )

    const probePath = `${userId}/deletion-probe-${Date.now()}.docx`
    const probeBlob = new Blob(['deletion-probe'], { type: DOCX_CONTENT_TYPE })
    const { error: uploadError } = await client.storage.from('resumes').upload(probePath, probeBlob, {
      contentType: DOCX_CONTENT_TYPE,
      upsert: false,
    })
    assertStep(!uploadError, 'uploaded deletion probe object')

    const { error: insertError } = await client.from('resumes').insert({
      filename: 'deletion-probe.docx',
      storage_path: probePath,
      size_bytes: probeBlob.size,
    })
    if (insertError) {
      const { data: removed, error: cleanupError } = await client.storage.from('resumes').remove([probePath])
      assertStep(!cleanupError && removed?.length === 1, 'cleaned up probe object after row insert failed')
      throw new Error('FAIL: could not insert deletion probe row')
    }
    pass('inserted deletion probe row')

    const paths = await listAllStoragePaths(client, userId)
    assertStep(paths.includes(probePath), 'listed deletion probe before delete-all')
    await removeAllStoragePaths(client, paths)

    const { error: rpcError } = await client.rpc('delete_my_data')
    assertStep(!rpcError, 'delete_my_data removed User 1 resume rows')

    const [{ data: remainingRows, error: remainingRowsError }, remainingPaths] = await Promise.all([
      client.from('resumes').select('*'),
      listAllStoragePaths(client, userId),
    ])
    assertStep(!remainingRowsError && remainingRows?.length === 0, 'post-delete resume row count is zero')
    assertStep(remainingPaths.length === 0, 'post-delete storage object count is zero')
    pass('delete-all verification completed with both database and storage empty')
  } finally {
    await client.auth.signOut()
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  runDeletionVerification().catch((error) => {
    console.error(error instanceof Error ? error.message : 'FAIL: deletion verification failed')
    process.exitCode = 1
  })
}

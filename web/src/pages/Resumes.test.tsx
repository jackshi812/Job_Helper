import { QueryClient } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resumeQueryKey, type ResumeRecord } from '../lib/resumes'
import { Resumes } from './Resumes'

const harness = vi.hoisted(() => ({
  mutationOptions: [] as Array<Record<string, unknown>>,
  queryClient: undefined as unknown,
}))

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useMutation: (options: Record<string, unknown>) => {
    harness.mutationOptions.push(options)
    return {
      error: null,
      isPending: false,
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      reset: vi.fn(),
    }
  },
  useQuery: () => ({ data: [], error: null, isPending: false }),
  useQueryClient: () => harness.queryClient,
}))

vi.mock('../auth/AuthProvider', () => ({
  useSession: () => ({ session: { user: { id: 'user-a' } } }),
}))

vi.mock('../lib/resumes', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/resumes')>(),
  deleteResume: vi.fn(),
  downloadResume: vi.fn(),
  listResumes: vi.fn(),
  uploadResume: vi.fn(),
}))

interface UploadMutationOptions {
  onSuccess: (
    resume: ResumeRecord,
    variables: { file: File; name: string; userId: string },
  ) => Promise<void>
}

interface DeleteMutationOptions {
  onSuccess: (
    result: void,
    variables: { id: string; storagePath: string; userId: string },
  ) => Promise<void>
}

function captureMutationOptions() {
  renderToStaticMarkup(<Resumes />)
  const [upload, deletion] = harness.mutationOptions
  if (!upload || !deletion) throw new Error('Resumes mutations were not captured')
  return {
    deletion: deletion as unknown as DeleteMutationOptions,
    upload: upload as unknown as UploadMutationOptions,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const oldResume: ResumeRecord = {
  id: 'old-resume',
  filename: 'old.docx',
  display_name: 'Old resume',
  storage_path: 'user-a/old.docx',
  size_bytes: 512,
  created_at: '2026-08-03T00:00:00.000Z',
}

const uploadedResume: ResumeRecord = {
  ...oldResume,
  id: 'uploaded-resume',
  filename: 'uploaded.docx',
  display_name: 'Uploaded resume',
  storage_path: 'user-a/uploaded.docx',
  created_at: '2026-08-04T00:00:00.000Z',
}

describe('Resumes mutation cache settlement', () => {
  beforeEach(() => {
    harness.mutationOptions.length = 0
  })

  it('keeps a successful upload when an older list read settles afterward', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const key = resumeQueryKey('user-a')
    const staleRead = deferred<ResumeRecord[]>()
    queryClient.setQueryData(key, [oldResume])
    const inFlightRead = queryClient.fetchQuery({
      queryKey: key,
      queryFn: () => staleRead.promise,
    }).catch(() => undefined)
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries')
    harness.queryClient = queryClient
    const { upload } = captureMutationOptions()

    await upload.onSuccess(uploadedResume, {
      file: new File(['docx'], uploadedResume.filename),
      name: uploadedResume.display_name ?? '',
      userId: 'user-a',
    })
    staleRead.resolve([oldResume])
    await inFlightRead

    expect(cancelQueries).toHaveBeenCalledWith({ queryKey: key, exact: true })
    expect(queryClient.getQueryData(key)).toEqual([uploadedResume, oldResume])
    queryClient.clear()
  })

  it('keeps a successful deletion when an older list read settles afterward', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const key = resumeQueryKey('user-a')
    const staleRead = deferred<ResumeRecord[]>()
    queryClient.setQueryData(key, [oldResume, uploadedResume])
    const inFlightRead = queryClient.fetchQuery({
      queryKey: key,
      queryFn: () => staleRead.promise,
    }).catch(() => undefined)
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries')
    harness.queryClient = queryClient
    const { deletion } = captureMutationOptions()

    await deletion.onSuccess(undefined, {
      id: oldResume.id,
      storagePath: oldResume.storage_path,
      userId: 'user-a',
    })
    staleRead.resolve([oldResume, uploadedResume])
    await inFlightRead

    expect(cancelQueries).toHaveBeenCalledWith({ queryKey: key, exact: true })
    expect(queryClient.getQueryData(key)).toEqual([uploadedResume])
    queryClient.clear()
  })
})

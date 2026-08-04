import { beforeEach, describe, expect, it, vi } from 'vitest'
import resumesPageSource from '../pages/Resumes.tsx?raw'
import {
  defaultDisplayName,
  deleteResume,
  MAX_RESUME_SIZE_BYTES,
  removeResumeFromList,
  resumeLabel,
  resumeQueryKey,
  uploadResume,
  upsertResumeInList,
  type ResumeRecord,
} from './resumes'
import { supabase } from './supabase'

vi.mock('./supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    storage: { from: vi.fn() },
    from: vi.fn(),
    // Refilter trigger fired after a successful upload/delete (D-04/D-10).
    rpc: vi.fn().mockResolvedValue({ error: null }),
  },
}))

const user = { id: '11111111-1111-4111-8111-111111111111' }

describe('uploadResume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabase.rpc).mockReset().mockResolvedValue({ error: null } as never)
  })

  it('rejects PDF before making a network call because Best Fit requires DOCX', async () => {
    const file = new File(['pdf'], 'resume.pdf', { type: 'application/pdf' })

    await expect(uploadResume(file, user.id)).rejects.toThrow(
      'Best Fit currently supports DOCX files only',
    )
    expect(supabase.auth.getUser).not.toHaveBeenCalled()
    expect(supabase.storage.from).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('uses a user-scoped UUID path and stores the original filename as metadata', async () => {
    const uuid = '22222222-2222-4222-8222-222222222222'
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(uuid)
    const upload = vi.fn().mockResolvedValue({ data: { path: `${user.id}/${uuid}.docx` }, error: null })
    vi.mocked(supabase.storage.from).mockReturnValue({ upload, remove: vi.fn() } as never)

    const row = {
      id: '33333333-3333-4333-8333-333333333333',
      filename: 'Jack Resume.docx',
      display_name: null,
      storage_path: `${user.id}/${uuid}.docx`,
      size_bytes: 4,
      created_at: '2026-07-16T00:00:00.000Z',
    }
    const single = vi.fn().mockResolvedValue({ data: row, error: null })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    await expect(uploadResume(new File(['docx'], row.filename, {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }), user.id)).resolves.toEqual(row)
    expect(upload).toHaveBeenCalledWith(
      `${user.id}/${uuid}.docx`,
      expect.any(File),
      {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: false,
      },
    )
    expect(insert).toHaveBeenCalledWith({
      filename: row.filename,
      display_name: null,
      storage_path: `${user.id}/${uuid}.docx`,
      size_bytes: 4,
    })
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(supabase.auth.getUser).not.toHaveBeenCalled()
  })

  it('reports the committed upload as successful without a fallible refresh RPC', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('66666666-6666-4666-8666-666666666666')
    vi.mocked(supabase.storage.from).mockReturnValue({
      upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
      remove: vi.fn(),
    } as never)
    const row = {
      id: '77777777-7777-4777-8777-777777777777',
      filename: 'resume.docx',
      display_name: null,
      storage_path: `${user.id}/66666666-6666-4666-8666-666666666666.docx`,
      size_bytes: 4,
      created_at: '2026-07-23T00:00:00.000Z',
    }
    const single = vi.fn().mockResolvedValue({ data: row, error: null })
    vi.mocked(supabase.from).mockReturnValue({
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) }),
    } as never)
    vi.mocked(supabase.rpc).mockRejectedValue(new Error('refresh unavailable'))

    await expect(uploadResume(new File(['docx'], 'resume.docx'), user.id)).resolves.toEqual(row)
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(supabase.auth.getUser).not.toHaveBeenCalled()
  })

  it('removes an uploaded object if the metadata insert fails', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('44444444-4444-4444-8444-444444444444')
    const remove = vi.fn().mockResolvedValue({ data: [], error: null })
    vi.mocked(supabase.storage.from).mockReturnValue({
      upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
      remove,
    } as never)
    const single = vi.fn().mockResolvedValue({ data: null, error: new Error('insert failed') })
    vi.mocked(supabase.from).mockReturnValue({
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) }),
    } as never)

    await expect(uploadResume(new File(['docx'], 'resume.docx'), user.id)).rejects.toThrow(
      'insert failed',
    )
    expect(remove).toHaveBeenCalledWith([`${user.id}/44444444-4444-4444-8444-444444444444.docx`])
  })

  describe('display name', () => {
    // Returns the `insert` spy so each case can assert on the persisted payload.
    function mockSuccessfulUpload() {
      vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('55555555-5555-4555-8555-555555555555')
      vi.mocked(supabase.storage.from).mockReturnValue({
        upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
        remove: vi.fn(),
      } as never)
      const single = vi.fn().mockResolvedValue({ data: {}, error: null })
      const insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) })
      vi.mocked(supabase.from).mockReturnValue({ insert } as never)
      return insert
    }

    it('stores null when no display name is supplied', async () => {
      const insert = mockSuccessfulUpload()

      await uploadResume(new File(['docx'], 'resume.docx'), user.id)

      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ display_name: null }))
    })

    it('trims a supplied display name before storing it', async () => {
      const insert = mockSuccessfulUpload()

      await uploadResume(new File(['docx'], 'resume.docx'), user.id, '  Backend CV  ')

      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ display_name: 'Backend CV' }))
    })

    it('collapses a whitespace-only display name to null', async () => {
      const insert = mockSuccessfulUpload()

      await uploadResume(new File(['docx'], 'resume.docx'), user.id, '   ')

      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ display_name: null }))
    })

    it('validates the file extension, never the display name', async () => {
      const file = new File(['plain text'], 'resume.txt', { type: 'text/plain' })

      // A display name ending in an allowed extension must not smuggle the file past
      // validation — allowedExtension reads file.name only (T-WUI-02).
      await expect(uploadResume(file, user.id, 'Anything.docx')).rejects.toThrow(
        'Best Fit currently supports DOCX files only',
      )
      expect(supabase.auth.getUser).not.toHaveBeenCalled()
      expect(supabase.storage.from).not.toHaveBeenCalled()
      expect(supabase.from).not.toHaveBeenCalled()
    })
  })

  it('accepts the exact 5 MiB boundary without an auth read', async () => {
    const file = new File([new Uint8Array(MAX_RESUME_SIZE_BYTES)], 'resume.docx')
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '88888888-8888-4888-8888-888888888888',
    )
    vi.mocked(supabase.storage.from).mockReturnValue({
      upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
      remove: vi.fn(),
    } as never)
    const row: ResumeRecord = {
      id: '99999999-9999-4999-8999-999999999999',
      filename: file.name,
      display_name: null,
      storage_path: `${user.id}/88888888-8888-4888-8888-888888888888.docx`,
      size_bytes: MAX_RESUME_SIZE_BYTES,
      created_at: '2026-08-04T00:00:00.000Z',
    }
    vi.mocked(supabase.from).mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: row, error: null }),
        }),
      }),
    } as never)

    await expect(uploadResume(file, user.id)).resolves.toEqual(row)
    expect(supabase.auth.getUser).not.toHaveBeenCalled()
  })

  it('rejects boundary-plus-one before storage or database work', async () => {
    const file = new File([new Uint8Array(MAX_RESUME_SIZE_BYTES + 1)], 'resume.docx')

    await expect(uploadResume(file, user.id)).rejects.toThrow(
      'Resume files must be 5 MB or smaller',
    )

    expect(supabase.auth.getUser).not.toHaveBeenCalled()
    expect(supabase.storage.from).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('rejects a blank supplied user ID before storage or database work', async () => {
    await expect(uploadResume(new File(['docx'], 'resume.docx'), '  ')).rejects.toThrow(
      'You must be signed in to upload a resume',
    )

    expect(supabase.auth.getUser).not.toHaveBeenCalled()
    expect(supabase.storage.from).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
  })
})

describe('resume list cache helpers', () => {
  const first: ResumeRecord = {
    id: 'resume-1',
    filename: 'first.docx',
    display_name: 'First',
    storage_path: 'user/resume-1.docx',
    size_bytes: 10,
    created_at: '2026-08-04T00:00:00.000Z',
  }
  const second: ResumeRecord = {
    ...first,
    id: 'resume-2',
    filename: 'second.docx',
    display_name: 'Second',
    storage_path: 'user/resume-2.docx',
  }

  it('upserts the durable record at the front without duplicate IDs', () => {
    const current = [first, second]
    const replacement = { ...first, display_name: 'Updated' }

    expect(upsertResumeInList(current, replacement)).toEqual([replacement, second])
    expect(current).toEqual([first, second])
    expect(upsertResumeInList(undefined, replacement)).toEqual([replacement])
  })

  it('scopes the shared cache key to the authenticated user', () => {
    expect(resumeQueryKey('user-a')).toEqual(['resumes', 'user-a'])
    expect(resumeQueryKey('user-b')).toEqual(['resumes', 'user-b'])
    expect(resumeQueryKey('user-b')).not.toEqual(resumeQueryKey('user-a'))
  })

  it('removes exactly the successful ID while tolerating an undefined cache', () => {
    const current = [first, second]

    expect(removeResumeFromList(current, first.id)).toEqual([second])
    expect(current).toEqual([first, second])
    expect(removeResumeFromList(undefined, first.id)).toEqual([])
  })

  it('settles Resumes mutations from session-backed cache writes only', () => {
    expect(resumesPageSource).toContain('useSession')
    expect(resumesPageSource).toContain('session.user.id')
    expect(resumesPageSource).toContain("resumeQueryKey(session?.user.id ?? '')")
    expect(resumesPageSource).toContain('upsertResumeInList')
    expect(resumesPageSource).toContain('removeResumeFromList')
    expect(resumesPageSource.match(/setQueryData<ResumeRecord\[]>/g)).toHaveLength(2)
    expect(resumesPageSource).not.toContain('invalidateQueries')
  })
})

describe('resumeLabel', () => {
  it('prefers the display name when one is set', () => {
    expect(resumeLabel({ display_name: 'Backend CV', filename: 'r.pdf' })).toBe('Backend CV')
  })

  it('falls back to the filename when the display name is null', () => {
    expect(resumeLabel({ display_name: null, filename: 'r.pdf' })).toBe('r.pdf')
  })
})

describe('defaultDisplayName', () => {
  it('strips the final extension', () => {
    expect(defaultDisplayName('Jack Resume.pdf')).toBe('Jack Resume')
  })

  it('strips only the last dot-suffix', () => {
    expect(defaultDisplayName('my.resume.v2.docx')).toBe('my.resume.v2')
  })

  it('returns a name with no dot unchanged', () => {
    expect(defaultDisplayName('resume')).toBe('resume')
  })

  it('leaves dotfile-style names intact', () => {
    expect(defaultDisplayName('.resume')).toBe('.resume')
  })
})

describe('deleteResume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabase.rpc).mockReset().mockResolvedValue({ error: null } as never)
  })

  it('deletes storage before deleting the metadata row', async () => {
    const calls: string[] = []
    const storagePath = `${user.id}/resume.docx`
    const remove = vi.fn().mockImplementation(async () => {
      calls.push('storage')
      return { data: [{ name: storagePath }], error: null }
    })
    vi.mocked(supabase.storage.from).mockReturnValue({ remove } as never)
    const eq = vi.fn().mockImplementation(async () => {
      calls.push('row')
      return { error: null }
    })
    vi.mocked(supabase.from).mockReturnValue({ delete: vi.fn().mockReturnValue({ eq }) } as never)

    await deleteResume({ id: 'resume-id', storagePath })

    expect(calls).toEqual(['storage', 'row'])
    expect(remove).toHaveBeenCalledWith([storagePath])
    expect(eq).toHaveBeenCalledWith('id', 'resume-id')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('reports the committed deletion as successful without a fallible refresh RPC', async () => {
    const storagePath = `${user.id}/resume.docx`
    vi.mocked(supabase.storage.from).mockReturnValue({
      remove: vi.fn().mockResolvedValue({
        data: [{ name: storagePath }],
        error: null,
      }),
    } as never)
    vi.mocked(supabase.from).mockReturnValue({
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    } as never)
    vi.mocked(supabase.rpc).mockRejectedValue(new Error('refresh unavailable'))

    await expect(deleteResume({ id: 'resume-id', storagePath })).resolves.toBeUndefined()
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('deletes the row when storage returns its normal empty success response', async () => {
    vi.mocked(supabase.storage.from).mockReturnValue({
      remove: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as never)
    const eq = vi.fn().mockResolvedValue({ error: null })
    const rowDelete = vi.fn().mockReturnValue({ eq })
    vi.mocked(supabase.from).mockReturnValue({ delete: rowDelete } as never)

    await expect(
      deleteResume({ id: 'resume-id', storagePath: `${user.id}/resume.docx` }),
    ).resolves.toBeUndefined()
    expect(rowDelete).toHaveBeenCalledOnce()
    expect(eq).toHaveBeenCalledWith('id', 'resume-id')
  })

  it('does not delete the row when storage reports an error', async () => {
    vi.mocked(supabase.storage.from).mockReturnValue({
      remove: vi.fn().mockResolvedValue({ data: null, error: new Error('storage failed') }),
    } as never)
    const rowDelete = vi.fn()
    vi.mocked(supabase.from).mockReturnValue({ delete: rowDelete } as never)

    await expect(
      deleteResume({ id: 'resume-id', storagePath: `${user.id}/resume.docx` }),
    ).rejects.toThrow('storage failed')
    expect(rowDelete).not.toHaveBeenCalled()
  })
})

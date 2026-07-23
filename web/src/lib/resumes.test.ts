import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultDisplayName, deleteResume, resumeLabel, uploadResume } from './resumes'
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

  it('rejects a disallowed extension before making a network call', async () => {
    const file = new File(['plain text'], 'resume.txt', { type: 'text/plain' })

    await expect(uploadResume(file)).rejects.toThrow('Only DOCX and PDF files are allowed')
    expect(supabase.auth.getUser).not.toHaveBeenCalled()
    expect(supabase.storage.from).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('uses a user-scoped UUID path and stores the original filename as metadata', async () => {
    const uuid = '22222222-2222-4222-8222-222222222222'
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(uuid)
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user }, error: null } as never)

    const upload = vi.fn().mockResolvedValue({ data: { path: `${user.id}/${uuid}.pdf` }, error: null })
    vi.mocked(supabase.storage.from).mockReturnValue({ upload, remove: vi.fn() } as never)

    const row = {
      id: '33333333-3333-4333-8333-333333333333',
      filename: 'Jack Resume.pdf',
      display_name: null,
      storage_path: `${user.id}/${uuid}.pdf`,
      size_bytes: 3,
      created_at: '2026-07-16T00:00:00.000Z',
    }
    const single = vi.fn().mockResolvedValue({ data: row, error: null })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    await expect(uploadResume(new File(['pdf'], row.filename, { type: 'application/pdf' }))).resolves.toEqual(row)
    expect(upload).toHaveBeenCalledWith(
      `${user.id}/${uuid}.pdf`,
      expect.any(File),
      { contentType: 'application/pdf', upsert: false },
    )
    expect(insert).toHaveBeenCalledWith({
      filename: row.filename,
      display_name: null,
      storage_path: `${user.id}/${uuid}.pdf`,
      size_bytes: 3,
    })
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('reports the committed upload as successful without a fallible refresh RPC', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('66666666-6666-4666-8666-666666666666')
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user }, error: null } as never)
    vi.mocked(supabase.storage.from).mockReturnValue({
      upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
      remove: vi.fn(),
    } as never)
    const row = {
      id: '77777777-7777-4777-8777-777777777777',
      filename: 'resume.pdf',
      display_name: null,
      storage_path: `${user.id}/66666666-6666-4666-8666-666666666666.pdf`,
      size_bytes: 3,
      created_at: '2026-07-23T00:00:00.000Z',
    }
    const single = vi.fn().mockResolvedValue({ data: row, error: null })
    vi.mocked(supabase.from).mockReturnValue({
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) }),
    } as never)
    vi.mocked(supabase.rpc).mockRejectedValue(new Error('refresh unavailable'))

    await expect(uploadResume(new File(['pdf'], 'resume.pdf'))).resolves.toEqual(row)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('removes an uploaded object if the metadata insert fails', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('44444444-4444-4444-8444-444444444444')
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user }, error: null } as never)
    const remove = vi.fn().mockResolvedValue({ data: [], error: null })
    vi.mocked(supabase.storage.from).mockReturnValue({
      upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
      remove,
    } as never)
    const single = vi.fn().mockResolvedValue({ data: null, error: new Error('insert failed') })
    vi.mocked(supabase.from).mockReturnValue({
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) }),
    } as never)

    await expect(uploadResume(new File(['docx'], 'resume.docx'))).rejects.toThrow('insert failed')
    expect(remove).toHaveBeenCalledWith([`${user.id}/44444444-4444-4444-8444-444444444444.docx`])
  })

  describe('display name', () => {
    // Returns the `insert` spy so each case can assert on the persisted payload.
    function mockSuccessfulUpload() {
      vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('55555555-5555-4555-8555-555555555555')
      vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user }, error: null } as never)
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

      await uploadResume(new File(['pdf'], 'resume.pdf'))

      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ display_name: null }))
    })

    it('trims a supplied display name before storing it', async () => {
      const insert = mockSuccessfulUpload()

      await uploadResume(new File(['pdf'], 'resume.pdf'), '  Backend CV  ')

      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ display_name: 'Backend CV' }))
    })

    it('collapses a whitespace-only display name to null', async () => {
      const insert = mockSuccessfulUpload()

      await uploadResume(new File(['pdf'], 'resume.pdf'), '   ')

      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ display_name: null }))
    })

    it('validates the file extension, never the display name', async () => {
      const file = new File(['plain text'], 'resume.txt', { type: 'text/plain' })

      // A display name ending in an allowed extension must not smuggle the file past
      // validation — allowedExtension reads file.name only (T-WUI-02).
      await expect(uploadResume(file, 'Anything.pdf')).rejects.toThrow('Only DOCX and PDF files are allowed')
      expect(supabase.auth.getUser).not.toHaveBeenCalled()
      expect(supabase.storage.from).not.toHaveBeenCalled()
      expect(supabase.from).not.toHaveBeenCalled()
    })
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

  it('does not delete the row when storage returns an empty success response', async () => {
    vi.mocked(supabase.storage.from).mockReturnValue({
      remove: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as never)
    const rowDelete = vi.fn()
    vi.mocked(supabase.from).mockReturnValue({ delete: rowDelete } as never)

    await expect(deleteResume({ id: 'resume-id', storagePath: `${user.id}/resume.docx` })).rejects.toThrow(
      'Storage delete incomplete',
    )
    expect(rowDelete).not.toHaveBeenCalled()
  })
})

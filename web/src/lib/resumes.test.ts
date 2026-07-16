import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteResume, uploadResume } from './resumes'
import { supabase } from './supabase'

vi.mock('./supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    storage: { from: vi.fn() },
    from: vi.fn(),
  },
}))

const user = { id: '11111111-1111-4111-8111-111111111111' }

describe('uploadResume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      storage_path: `${user.id}/${uuid}.pdf`,
      size_bytes: 3,
    })
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
})

describe('deleteResume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

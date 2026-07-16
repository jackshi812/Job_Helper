import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supabase } from '../lib/supabase'
import {
  DELETE_CONFIRMATION_TEXT,
  matchesRequiredText,
} from '../components/TypeToConfirmDialog'
import { changePassword, deleteAllMyData } from './Settings'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { updateUser: vi.fn() },
    storage: { from: vi.fn() },
    rpc: vi.fn(),
  },
}))

const auth = supabase.auth as unknown as { updateUser: ReturnType<typeof vi.fn> }
const storage = supabase.storage as unknown as { from: ReturnType<typeof vi.fn> }
const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>

describe('Settings account actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reauthenticates with the current password while changing it', async () => {
    auth.updateUser.mockResolvedValue({ data: {}, error: null })

    await changePassword('old-password', 'new-password')

    expect(auth.updateUser).toHaveBeenCalledWith({
      current_password: 'old-password',
      password: 'new-password',
    })
  })

  it('removes every listed object before deleting database rows', async () => {
    const list = vi.fn().mockResolvedValue({
      data: [{ name: 'one.docx' }, { name: 'two.pdf' }],
      error: null,
    })
    const remove = vi.fn().mockResolvedValue({
      data: [{ name: 'user-1/one.docx' }, { name: 'user-1/two.pdf' }],
      error: null,
    })
    storage.from.mockReturnValue({ list, remove })
    rpc.mockResolvedValue({ data: null, error: null })

    await deleteAllMyData('user-1')

    expect(list).toHaveBeenCalledWith('user-1', expect.objectContaining({ limit: 1000 }))
    expect(remove).toHaveBeenCalledWith(['user-1/one.docx', 'user-1/two.pdf'])
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0])
    expect(rpc).toHaveBeenCalledWith('delete_my_data')
  })

  it('does not delete rows when storage reports an incomplete removal', async () => {
    const list = vi.fn().mockResolvedValue({ data: [{ name: 'one.docx' }], error: null })
    const remove = vi.fn().mockResolvedValue({ data: [], error: null })
    storage.from.mockReturnValue({ list, remove })

    await expect(deleteAllMyData('user-1')).rejects.toThrow('storage delete incomplete')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('requires an exact type-to-confirm match', () => {
    expect(matchesRequiredText('DELETE', DELETE_CONFIRMATION_TEXT)).toBe(true)
    expect(matchesRequiredText('delete', DELETE_CONFIRMATION_TEXT)).toBe(false)
    expect(matchesRequiredText(' DELETE ', DELETE_CONFIRMATION_TEXT)).toBe(false)
  })
})

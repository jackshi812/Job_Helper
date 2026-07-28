import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supabase } from '../lib/supabase'
import {
  DELETE_CONFIRMATION_TEXT,
  matchesRequiredText,
} from '../components/TypeToConfirmDialog'
import { reauthenticate } from '../lib/supabase'
import {
  changePassword,
  deleteAllMyData,
} from './Settings'
import settingsSource from './Settings.tsx?raw'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { updateUser: vi.fn() },
    storage: { from: vi.fn() },
    rpc: vi.fn(),
  },
  reauthenticate: vi.fn(),
}))

const auth = supabase.auth as unknown as { updateUser: ReturnType<typeof vi.fn> }
const storage = supabase.storage as unknown as { from: ReturnType<typeof vi.fn> }
const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>
const reauthenticateMock = reauthenticate as unknown as ReturnType<typeof vi.fn>

describe('Settings account actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reauthenticates with the current password before changing it', async () => {
    reauthenticateMock.mockResolvedValue({ error: null })
    auth.updateUser.mockResolvedValue({ data: {}, error: null })

    await changePassword('user@example.com', 'old-password', 'new-password')

    expect(reauthenticateMock).toHaveBeenCalledWith('user@example.com', 'old-password')
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'new-password' })
  })

  it('does not change the password when reauthentication fails', async () => {
    reauthenticateMock.mockResolvedValue({ error: new Error('Invalid login credentials') })

    await expect(
      changePassword('user@example.com', 'wrong-password', 'new-password'),
    ).rejects.toThrow('Invalid login credentials')

    expect(auth.updateUser).not.toHaveBeenCalled()
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

  it('clears stale personal-data caches and explains the retained shared scope', () => {
    expect(settingsSource).toContain('queryClient.clear()')
    expect(settingsSource).toContain(
      'All of your personal job data was permanently deleted.',
    )
    expect(settingsSource).toContain(
      'Your login and the shared company/job catalog remain.',
    )
  })
})

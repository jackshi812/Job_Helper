import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supabase } from '../lib/supabase'
import {
  DELETE_CONFIRMATION_TEXT,
  matchesRequiredText,
} from '../components/TypeToConfirmDialog'
import { reauthenticate } from '../lib/supabase'
import { loadPreferences, savePreferences } from '../lib/preferences'
import {
  changePassword,
  clampThreshold,
  deleteAllMyData,
  pushErrorMessage,
  saveNotificationSettings,
} from './Settings'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { updateUser: vi.fn() },
    storage: { from: vi.fn() },
    rpc: vi.fn(),
  },
  reauthenticate: vi.fn(),
}))

vi.mock('../lib/preferences', () => ({
  loadPreferences: vi.fn(),
  savePreferences: vi.fn(),
}))

const auth = supabase.auth as unknown as { updateUser: ReturnType<typeof vi.fn> }
const storage = supabase.storage as unknown as { from: ReturnType<typeof vi.fn> }
const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>
const reauthenticateMock = reauthenticate as unknown as ReturnType<typeof vi.fn>
const loadPreferencesMock = loadPreferences as unknown as ReturnType<typeof vi.fn>
const savePreferencesMock = savePreferences as unknown as ReturnType<typeof vi.fn>

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
})

describe('Settings notification settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clamps the instant-push threshold to a 0–100 integer', () => {
    expect(clampThreshold(150)).toBe(100)
    expect(clampThreshold(-20)).toBe(0)
    expect(clampThreshold(74.6)).toBe(75)
    expect(clampThreshold(Number.NaN)).toBe(75)
    expect(clampThreshold(75)).toBe(75)
  })

  it('merges, not overwrites, the existing preference arrays when saving notification fields', async () => {
    loadPreferencesMock.mockResolvedValue({
      titles: ['staff engineer'],
      locations: ['remote'],
      include_keywords: ['rust'],
      exclude_keywords: ['senior manager'],
      notify_threshold: 60,
      quiet_start: '22:00',
      quiet_end: '07:00',
      digest_time: '08:00',
      timezone: 'America/Chicago',
    })
    savePreferencesMock.mockResolvedValue(undefined)

    await saveNotificationSettings({
      notify_threshold: 90,
      quiet_start: '23:00',
      quiet_end: '06:00',
      digest_time: '09:30',
      timezone: 'America/New_York',
    })

    expect(loadPreferencesMock).toHaveBeenCalledOnce()
    expect(savePreferencesMock).toHaveBeenCalledWith({
      titles: ['staff engineer'],
      locations: ['remote'],
      include_keywords: ['rust'],
      exclude_keywords: ['senior manager'],
      notify_threshold: 90,
      quiet_start: '23:00',
      quiet_end: '06:00',
      digest_time: '09:30',
      timezone: 'America/New_York',
    })
  })

  it('defaults preference arrays to empty when no row exists yet', async () => {
    loadPreferencesMock.mockResolvedValue(null)
    savePreferencesMock.mockResolvedValue(undefined)

    await saveNotificationSettings({
      notify_threshold: 200,
      quiet_start: null,
      quiet_end: null,
      digest_time: '08:00',
      timezone: 'America/Chicago',
    })

    expect(savePreferencesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        titles: [],
        locations: [],
        include_keywords: [],
        exclude_keywords: [],
        notify_threshold: 100,
      }),
    )
  })

  it('surfaces each of the three bounded push-enable reasons', () => {
    expect(pushErrorMessage(new Error('permission denied'))).toBe(
      "Push couldn't be enabled (permission denied). Email digests still work.",
    )
    expect(pushErrorMessage(new Error('browser unsupported'))).toBe(
      "Push couldn't be enabled (browser unsupported). Email digests still work.",
    )
    expect(pushErrorMessage(new Error('subscription failed'))).toBe(
      "Push couldn't be enabled (subscription failed). Email digests still work.",
    )
  })

  it('collapses an unbounded error to the subscription-failed reason', () => {
    expect(pushErrorMessage(new Error('TypeError: navigator is undefined'))).toBe(
      "Push couldn't be enabled (subscription failed). Email digests still work.",
    )
    expect(pushErrorMessage('not an error object')).toBe(
      "Push couldn't be enabled (subscription failed). Email digests still work.",
    )
  })
})

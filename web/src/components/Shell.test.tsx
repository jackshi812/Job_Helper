import { describe, expect, it, vi } from 'vitest'
import shellSource from './Shell.tsx?raw'

vi.mock('../lib/supabase', () => ({ supabase: {} }))

describe('Shell route widths', () => {
  it('uses the full remaining width only for Dashboard', () => {
    expect(shellSource).toContain("pathname === '/'")
    expect(shellSource).toContain("? 'w-full px-4 py-8 sm:px-6'")
  })

  it('keeps job detail, preferences, and every non-index route centered', () => {
    expect(shellSource).toContain(": 'mx-auto max-w-6xl px-4 py-8 sm:px-6'")
    expect(shellSource).toContain('shellMainClass(location.pathname)')
  })

  it('does not widen the header or heartbeat banner', () => {
    expect(shellSource).toContain(
      'mx-auto flex max-w-6xl flex-wrap items-center',
    )
    expect(shellSource).toContain(
      'className="mx-auto max-w-6xl px-4 py-2 text-sm sm:px-6"',
    )
  })
})

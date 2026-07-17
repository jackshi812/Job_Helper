import { describe, expect, it } from 'vitest'
import { fingerprint } from '../../supabase/functions/_shared/dedup'

describe('fingerprint', () => {
  it('normalizes company, title, and the first location segment', () => {
    expect(
      fingerprint('Stripe', 'Software Engineer (Remote)', 'San Francisco, CA'),
    ).toBe('stripe|software engineer|san francisco')
  })

  it('uses an empty city segment when location is null', () => {
    expect(fingerprint('Stripe', 'Software Engineer', null)).toBe(
      'stripe|software engineer|',
    )
  })

  it('treats title punctuation and case as equivalent', () => {
    expect(fingerprint('Acme', 'Staff Engineer: Platform!', 'Austin, TX')).toBe(
      fingerprint('ACME', 'staff engineer platform', 'Austin, Texas'),
    )
  })
})

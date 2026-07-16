import { describe, expect, it } from 'vitest'
import { assertIsolation } from '../../scripts/verify-rls'

describe('RLS probe assertions', () => {
  it('fails closed with the required cross-user marker', () => {
    expect(() => assertIsolation(false, 'targeted resume read was visible')).toThrow(
      'CROSS-USER LEAK: targeted resume read was visible',
    )
  })

  it('allows a passing isolation probe to continue', () => {
    expect(() => assertIsolation(true, 'targeted resume read was blocked')).not.toThrow()
  })
})

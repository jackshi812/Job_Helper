import { describe, expect, it, vi } from 'vitest'
import { lookupCompanyDomain } from './outreach-domain-lookup'

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  })
}

describe('company-domain lookup', () => {
  it('uses one bounded Wikidata search and one P856 request for the best business result', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        search: [
          {
            aliases: ['BMO Financial Group'],
            description: 'Canadian investment bank',
            id: 'Q806693',
            label: 'Bank of Montreal',
          },
          {
            description: 'fictional character',
            id: 'Q101844317',
            label: 'BMO',
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        claims: {
          P856: [{
            mainsnak: { datavalue: { value: 'http://www.bmo.com/' } },
            rank: 'preferred',
          }],
        },
      }))
    const controller = new AbortController()

    await expect(lookupCompanyDomain('BMO', {
      fetchImpl,
      signal: controller.signal,
    })).resolves.toBe('bmo.com')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const searchUrl = new URL(fetchImpl.mock.calls[0][0])
    expect(searchUrl.origin).toBe('https://www.wikidata.org')
    expect(searchUrl.searchParams.get('action')).toBe('wbsearchentities')
    expect(searchUrl.searchParams.get('limit')).toBe('3')
    expect(searchUrl.searchParams.get('origin')).toBe('*')
    const claimsUrl = new URL(fetchImpl.mock.calls[1][0])
    expect(claimsUrl.searchParams.get('action')).toBe('wbgetclaims')
    expect(claimsUrl.searchParams.get('entity')).toBe('Q806693')
    expect(claimsUrl.searchParams.get('property')).toBe('P856')
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    })
  })

  it('rejects deprecated, credentialed, and malformed official-site claims', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        search: [{ description: 'technology company', id: 'Q1', label: 'Acme' }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        claims: {
          P856: [
            { mainsnak: { datavalue: { value: 'https://old.example.com' } }, rank: 'deprecated' },
            { mainsnak: { datavalue: { value: 'https://user:secret@example.com' } }, rank: 'normal' },
            { mainsnak: { datavalue: { value: 'not a url' } }, rank: 'normal' },
          ],
        },
      }))

    await expect(lookupCompanyDomain('Acme', {
      fetchImpl,
      signal: new AbortController().signal,
    })).resolves.toBeNull()
  })

  it('fails closed after an irrelevant search or malformed/non-JSON response', async () => {
    const irrelevantFetch = vi.fn().mockResolvedValue(jsonResponse({
      search: [{ description: 'fictional character', id: 'Q1', label: 'Unrelated' }],
    }))
    await expect(lookupCompanyDomain('Acme', {
      fetchImpl: irrelevantFetch,
      signal: new AbortController().signal,
    })).resolves.toBeNull()
    expect(irrelevantFetch).toHaveBeenCalledOnce()

    const malformedFetch = vi.fn().mockResolvedValue(new Response('<html>', {
      headers: { 'content-type': 'text/html' },
    }))
    await expect(lookupCompanyDomain('Acme', {
      fetchImpl: malformedFetch,
      signal: new AbortController().signal,
    })).resolves.toBeNull()
  })

  it('does no work for an aborted request and converts network failure to no result', async () => {
    const aborted = new AbortController()
    aborted.abort()
    const fetchImpl = vi.fn()
    await expect(lookupCompanyDomain('Acme', {
      fetchImpl,
      signal: aborted.signal,
    })).resolves.toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()

    fetchImpl.mockRejectedValueOnce(new Error('offline'))
    await expect(lookupCompanyDomain('Acme', {
      fetchImpl,
      signal: new AbortController().signal,
    })).resolves.toBeNull()
  })
})

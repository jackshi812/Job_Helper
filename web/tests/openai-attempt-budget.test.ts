import { afterEach, describe, expect, it, vi } from 'vitest'

import { generateStructured } from '../../supabase/functions/_shared/openai.ts'

const options = {
  model: 'test-model',
  prompt: 'bounded test prompt',
  schemaName: 'bounded_test',
  responseSchema: {
    type: 'object',
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
    additionalProperties: false,
  },
  apiKey: 'test-key',
}

describe('OpenAI physical-attempt budget', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('makes exactly one physical request when maxAttempts is one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(generateStructured({ ...options, maxAttempts: 1 })).rejects.toThrow(
      'openai_http_500',
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

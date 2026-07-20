// Stateless OpenAI Responses API wrapper shared by every Phase 3 AI call
// (resume keyword extraction and job scoring). D-11/D-12/D-13:
//   - Provider is the OpenAI API only, called via POST /v1/responses.
//   - store:false so Responses application-state is never persisted server-side.
//     This is NOT Zero Data Retention: OpenAI states API data is not used for
//     training unless explicitly opted in, but default abuse-monitoring logs may
//     retain prompts/responses for up to 30 days. Callers therefore MUST keep
//     resume/JD content out of application logs and out of ai_usage.
//   - reasoning.effort:'none' and strict Structured Outputs (text.format json_schema).
//   - Sampling parameters are omitted for this reasoning model (none is sent).
//
// ASVS V7 (errors & logging): this module never logs the prompt, the response
// text, or any argument containing resume/JD content. Error paths surface only
// bounded machine codes. apiKey is a parameter (never read from a runtime global)
// so a Node verification script and the Deno edge runtime exercise identical
// request shaping; the fetch call uses the standard global fetch available in both.

// D-12: default model for extraction + scoring.
export const OPENAI_SCORING_MODEL = 'gpt-5.4-nano'
// D-13: escalation valve only. Configuration-only — MUST NOT be called
// automatically or in parallel; upgrading requires an eval-backed operator
// decision. Named here so the choice is encoded, not so it is invoked.
export const OPENAI_FALLBACK_MODEL = 'gpt-5.6-luna'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const RETRY_BACKOFF_MS = [1000, 4000] as const

export interface OpenAIUsage {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
}

export interface GenerateStructuredOptions {
  model: string
  prompt: string
  schemaName: string
  responseSchema: object
  apiKey: string
  // Callers with a separately reserved physical-request budget must set this
  // to 1. Other callers retain the bounded three-attempt transient retry policy.
  maxAttempts?: number
}

interface ResponsesContentItem {
  type?: string
  text?: string
}

interface ResponsesOutputItem {
  type?: string
  role?: string
  content?: ResponsesContentItem[]
}

interface ResponsesBody {
  status?: string
  output?: ResponsesOutputItem[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
    output_tokens_details?: { reasoning_tokens?: number }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Collect every assistant output_text string and flag any refusal content item.
// The Responses `output` array interleaves reasoning items with the assistant
// message; only `output_text` content carries the strict-schema JSON payload.
function collectOutput(body: ResponsesBody): {
  texts: string[]
  refused: boolean
} {
  const texts: string[] = []
  let refused = false
  for (const item of body.output ?? []) {
    if (item.type !== 'message') continue
    for (const content of item.content ?? []) {
      if (content.type === 'refusal') refused = true
      else if (content.type === 'output_text' && typeof content.text === 'string') {
        texts.push(content.text)
      }
    }
  }
  return { texts, refused }
}

function mapUsage(body: ResponsesBody): OpenAIUsage {
  return {
    inputTokens: body.usage?.input_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
    reasoningTokens: body.usage?.output_tokens_details?.reasoning_tokens ?? 0,
  }
}

// One strict-schema Responses call. Returns the parsed JSON result plus token
// usage for ai_usage accounting. Retries only 429/5xx at most twice (1s then 4s)
// before rethrowing a bounded code. Never throws or logs raw provider text.
export async function generateStructured(
  opts: GenerateStructuredOptions,
): Promise<{ result: unknown; usage: OpenAIUsage }> {
  const maxAttempts = opts.maxAttempts ?? RETRY_BACKOFF_MS.length + 1
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > RETRY_BACKOFF_MS.length + 1) {
    throw new Error('openai_invalid_attempt_limit')
  }

  const requestBody = {
    model: opts.model,
    store: false,
    reasoning: { effort: 'none' },
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: opts.prompt }],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: opts.schemaName,
        strict: true,
        schema: opts.responseSchema,
      },
    },
  }

  let lastRetryableStatus = 0
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      // Drain the body so the connection can be reused; never inspect/log it.
      await response.text().catch(() => undefined)
      const status = response.status
      if ((status === 429 || status >= 500) && attempt + 1 < maxAttempts) {
        lastRetryableStatus = status
        await sleep(RETRY_BACKOFF_MS[attempt])
        continue
      }
      throw new Error(`openai_http_${status}`)
    }

    const body = (await response.json()) as ResponsesBody
    if (body.status === 'incomplete') throw new Error('openai_incomplete')

    const { texts, refused } = collectOutput(body)
    if (refused) throw new Error('openai_refusal')
    if (texts.length !== 1) throw new Error('openai_invalid_output')

    let result: unknown
    try {
      result = JSON.parse(texts[0])
    } catch {
      throw new Error('openai_invalid_output')
    }

    return { result, usage: mapUsage(body) }
  }

  // Exhausted retries on a transient status.
  throw new Error(`openai_http_${lastRetryableStatus || 503}`)
}

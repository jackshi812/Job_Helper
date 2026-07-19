// Live smoke test for the shared OpenAI Responses wrapper (Plan 03-02, Task 2).
// Run: node --env-file=scripts/.env scripts/verify-openai.ts
//
// Proves the strict Structured Outputs contract end-to-end BEFORE any scoring
// code is written: a single POST /v1/responses call with store:false, reasoning
// effort none, and a strict json_schema returns schema-valid JSON. Imports
// openai.ts directly so Node and the Deno edge runtime exercise identical request
// shaping. Prints only token counts — never the prompt or response text.

import {
  generateStructured,
  OPENAI_SCORING_MODEL,
} from '../supabase/functions/_shared/openai.ts'

const SMOKE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    score: { type: 'integer' },
    reasons: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['score', 'reasons'],
} as const

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error('verify-openai: OPENAI_API_KEY is not set in scripts/.env')
    process.exit(1)
  }

  const prompt =
    'You are validating a JSON schema pipeline. Return a JSON object whose ' +
    '"score" field is exactly the integer 42 and whose "reasons" field is an ' +
    'array of exactly three short, distinct, non-empty strings explaining, in ' +
    'plain language, that this is a fixed smoke-test value.'

  const { result, usage } = await generateStructured({
    model: OPENAI_SCORING_MODEL,
    prompt,
    schemaName: 'smoke_score',
    responseSchema: SMOKE_SCHEMA,
    apiKey,
  })

  const parsed = result as { score?: unknown; reasons?: unknown }
  const reasons = parsed.reasons

  if (parsed.score !== 42) {
    console.error(`verify-openai: expected score 42, got ${String(parsed.score)}`)
    process.exit(1)
  }
  if (
    !Array.isArray(reasons) ||
    reasons.length !== 3 ||
    !reasons.every((r) => typeof r === 'string' && r.trim().length > 0)
  ) {
    console.error('verify-openai: expected exactly three non-empty string reasons')
    process.exit(1)
  }

  console.log('verify-openai: OK — strict Structured Outputs call succeeded')
  console.log(`  model:            ${OPENAI_SCORING_MODEL}`)
  console.log(`  input_tokens:     ${usage.inputTokens}`)
  console.log(`  output_tokens:    ${usage.outputTokens}`)
  console.log(`  reasoning_tokens: ${usage.reasoningTokens}`)
}

main().catch((error) => {
  const code = error instanceof Error ? error.message : 'unknown_error'
  console.error(`verify-openai: FAILED — ${code}`)
  process.exit(1)
})

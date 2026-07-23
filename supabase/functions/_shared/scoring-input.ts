import { type FilterJobInput, type FilterPreferences } from './filters.ts'

export const SCORING_INPUT_VERSION = 'scoring-input-v1'

export interface ResumeExtractionSnapshot {
  textContent: string
  keywords: string[]
  model: string | null
  extractedAt: string | null
}

export interface ScoringInput {
  preferences: FilterPreferences
  job: FilterJobInput
  routedResumeId: string
  extraction: ResumeExtractionSnapshot
  scoringModel: string
  promptRevision: string
  filterRevision: string
  scoringInputVersion?: string
}

function canonicalText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

function canonicalArray(values: string[]): string[] {
  return [...new Set(values.map(canonicalText).filter(Boolean))].sort()
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function jobSnapshotDigest(job: FilterJobInput): Promise<string> {
  return sha256({
    title: canonicalText(job.title),
    location: canonicalText(job.location),
    descriptionText: canonicalText(job.descriptionText),
  })
}

export async function resumeExtractionDigest(
  extraction: ResumeExtractionSnapshot,
): Promise<string> {
  return sha256({
    textContent: canonicalText(extraction.textContent),
    keywords: canonicalArray(extraction.keywords),
    model: canonicalText(extraction.model),
    extractedAt: canonicalText(extraction.extractedAt),
  })
}

export async function scoringInputHash(input: ScoringInput): Promise<string> {
  const [jobDigest, extractionDigest] = await Promise.all([
    jobSnapshotDigest(input.job),
    resumeExtractionDigest(input.extraction),
  ])
  return sha256({
    version: canonicalText(input.scoringInputVersion ?? SCORING_INPUT_VERSION),
    preferences: {
      titles: canonicalArray(input.preferences.titles),
      locations: canonicalArray(input.preferences.locations),
      includeKeywords: canonicalArray(input.preferences.includeKeywords),
      excludeKeywords: canonicalArray(input.preferences.excludeKeywords),
      titleExcludeKeywords: canonicalArray(input.preferences.titleExcludeKeywords),
    },
    jobDigest,
    routedResumeId: canonicalText(input.routedResumeId),
    extractionDigest,
    scoringModel: canonicalText(input.scoringModel),
    promptRevision: canonicalText(input.promptRevision),
    filterRevision: canonicalText(input.filterRevision),
  })
}

export function shouldRescore(
  storedHash: string | null | undefined,
  currentHash: string,
): boolean {
  return storedHash !== currentHash
}

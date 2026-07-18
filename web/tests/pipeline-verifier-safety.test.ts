import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  PIPELINE_EVIDENCE_BEGIN,
  PIPELINE_EVIDENCE_END,
  PIPELINE_MUTATION_CLASSES,
  createPipelineEvidenceEnvelope,
  finalizePipelineEvidenceEnvelope,
  journalPipelineMutation,
  redactPipelineEvidence,
  type PipelineEvidenceSnapshot,
} from '../../scripts/verify-pipeline.ts'

const verifierPath = fileURLToPath(new URL('../../scripts/verify-pipeline.ts', import.meta.url))
const source = readFileSync(verifierPath, 'utf8')
const pollTickSource = readFileSync(
  fileURLToPath(new URL('../../supabase/functions/poll-tick/index.ts', import.meta.url)),
  'utf8',
)
const connectorSource = readFileSync(
  fileURLToPath(new URL('../../supabase/functions/_shared/connectors.ts', import.meta.url)),
  'utf8',
)

describe('pipeline reopen verifier ownership contract', () => {
  it('pins probe 15 to the bounded PlanetScale Greenhouse fixture', () => {
    expect(source).toContain("const PIPELINE_REOPEN_PROBE_PREFIX = 'phase-02.1-reopen-probe-'")
    expect(source).toContain("const PIPELINE_REOPEN_BOARD_TOKEN = 'planetscale'")
    expect(source).toContain("const PIPELINE_REOPEN_SOURCE_KEY = 'greenhouse:global:planetscale'")
    expect(source).toContain('const PIPELINE_REOPEN_MAX_JOBS = 25')
    expect(source).toContain('https://boards-api.greenhouse.io/v1/boards/${PIPELINE_REOPEN_BOARD_TOKEN}/jobs')
  })

  it('never selects, closes, or force-restores a pre-existing seed job', () => {
    expect(source).not.toContain('reopenCandidate')
    expect(source).not.toContain('reopenProbeRestore')
    expect(source).not.toMatch(/\.in\('company_id', seedIds\)[\s\S]{0,240}\.eq\('status', 'open'\)[\s\S]{0,160}\.limit\(1\)/)
    expect(source).not.toMatch(/update\(\{ status: 'open', closed_at: null, last_seen_at:/)
  })

  it('requires collision preflight, deployed polling, bounded observation, and exact cleanup', () => {
    expect(source).toContain('assertReopenFixtureAvailable')
    expect(source).toContain('drainDueCompanies')
    expect(source).toContain('snapshotRealJobs')
    expect(source).toContain('assertRealJobsUnchanged')
    expect(source).toContain('await postTick(environment.url, environment.cronSecret)')
    expect(source).toMatch(/for \(let attempt = 0; attempt < PIPELINE_REOPEN_OBSERVATION_ATTEMPTS;/)
    expect(source).toMatch(/\.delete\(\)\s*\.eq\('company_id', fixture\.companyId\)/)
    expect(source).toMatch(/\.delete\(\)\s*\.eq\('id', fixture\.companyId\)/)
    expect(source).toContain('assertReopenFixtureRemoved')
  })

  it('keeps production lifecycle execution behind the active connector registry', () => {
    expect(source).not.toContain("from '../supabase/functions/_shared/lifecycle.ts'")
    expect(source).not.toContain('planCompanySync(')
    expect(source).toContain("activation_state: 'active'")
    expect(source).toContain("ats_type: 'greenhouse'")
    expect(pollTickSource).toContain('admin.rpc(\'claim_due_companies\'')
    expect(pollTickSource).toContain('processCompany(admin, company)')
    expect(pollTickSource).toContain('await pollConnector(company, knownIds)')
    expect(pollTickSource).toContain('const plan = planCompanySync(existing, observation, seenAt)')
    expect(connectorSource).toContain("greenhouse: {")
    expect(connectorSource).toContain('await pollGreenhouse(company.board_token, knownIds)')
    expect(connectorSource).toContain("if (company.activation_state !== 'active')")
  })

  it('keeps fingerprint repost merges lifecycle-only and duplicate-free', () => {
    const repostBranch = pollTickSource.match(
      /const repostId = companyFingerprintIds\.get\(job\.fingerprint\)([\s\S]*?)inserts\.push\(row\)/,
    )?.[1]

    expect(repostBranch).toBeDefined()
    expect(repostBranch).toContain('fingerprintRepostLifecycleUpdate(seenAt)')
    expect(repostBranch).toMatch(/\.eq\('id', repostId\)[\s\S]*?continue/)
    expect(repostBranch).not.toMatch(/source\s*:/)
    expect(repostBranch).not.toMatch(/external_id\s*:/)
    expect(repostBranch).not.toMatch(/title\s*:/)
    expect(repostBranch).not.toMatch(/location\s*:/)
    expect(repostBranch).not.toMatch(/description_(?:html|text)\s*:/)
  })

  it('orders every destructive action after preflight and bounds all hosted work', () => {
    const preflight = source.indexOf('await assertReopenFixtureAvailable(admin, fixtureBoard.externalIds)')
    const drain = source.indexOf('await drainDueCompanies(url, cronSecret)')
    const baseline = source.indexOf('const realJobBaseline = await snapshotRealJobs(admin)')
    const companyInsert = source.indexOf("admin.from('companies').insert({", baseline)
    expect(preflight).toBeGreaterThan(0)
    expect(drain).toBeGreaterThan(preflight)
    expect(baseline).toBeGreaterThan(drain)
    expect(companyInsert).toBeGreaterThan(baseline)
    expect(source).toContain('attempt < PIPELINE_REOPEN_DRAIN_ATTEMPTS')
    expect(source).toContain('attempt < PIPELINE_REOPEN_OBSERVATION_ATTEMPTS')
    expect(source).not.toContain('setInterval(')
  })

  it('contains no verifier-only production bypass surface', () => {
    expect(source).not.toMatch(/x-(?:test|verifier|fixture|bypass)/i)
    expect(pollTickSource).not.toMatch(/x-(?:test|verifier|fixture|bypass)/i)
    expect(pollTickSource).not.toMatch(/phase-02\.1-reopen-probe/i)
  })
})

const snapshot = (
  capturedAt: string,
  overrides: Partial<PipelineEvidenceSnapshot> = {},
): PipelineEvidenceSnapshot => ({
  capturedAt,
  seedIdentities: {},
  activeCompanies: {},
  jobs: {},
  pipelineHeartbeat: {},
  fixtureResidue: {
    reopenMarkers: 0,
    reopenSourceKeys: 0,
    reopenReturnedJobs: 0,
    deniedRlsRows: 0,
  },
  ...overrides,
})

describe('pipeline verifier evidence envelope', () => {
  it('registers every production mutation class with one explicit disposition', () => {
    expect(PIPELINE_MUTATION_CLASSES.map(({ id }) => id)).toEqual([
      'optional_seed_creation',
      'seed_poll_timestamps',
      'provider_job_lifecycle',
      'provider_company_health',
      'pipeline_heartbeat',
      'discovery_sweep_primary',
      'adzuna_quota_and_jobs',
      'concurrent_claim_timestamps',
      'all_active_no_work_timestamps',
      'denied_rls_insert_cleanup',
      'planetscale_reopen_fixture',
      'discovery_sweep_health',
      'discovery_heartbeat',
    ])
    expect(new Set(PIPELINE_MUTATION_CLASSES.map(({ id }) => id)).size).toBe(
      PIPELINE_MUTATION_CLASSES.length,
    )
    expect(PIPELINE_MUTATION_CLASSES.every(({ disposition, acceptancePredicate }) =>
      ['expected_durable', 'temporary_must_restore', 'fixture_must_delete'].includes(disposition) &&
      acceptancePredicate.length > 0
    )).toBe(true)
  })

  it('captures entry before the first write and post-drain at the attainable internal seam', () => {
    const entryCapture = source.indexOf("capturePipelineEvidenceSnapshot(admin, 'entry'")
    const ensureSeeds = source.indexOf('await ensureSeeds(admin, userClient)')
    const reopenCall = source.indexOf('await runReopenFixtureProbe(', ensureSeeds)
    const drain = source.indexOf('await drainDueCompanies(url, cronSecret)')
    const postDrainCapture = source.indexOf("capturePipelineEvidenceSnapshot(admin, 'post_drain'", drain)
    const fixtureInsert = source.indexOf("admin.from('companies').insert({", postDrainCapture)

    expect(entryCapture).toBeGreaterThan(0)
    expect(ensureSeeds).toBeGreaterThan(entryCapture)
    expect(reopenCall).toBeGreaterThan(ensureSeeds)
    expect(postDrainCapture).toBeGreaterThan(drain)
    expect(fixtureInsert).toBeGreaterThan(postDrainCapture)
    expect(source).toContain(PIPELINE_EVIDENCE_BEGIN)
    expect(source).toContain(PIPELINE_EVIDENCE_END)
  })

  it('attributes scheduled-cron provider effects alongside its heartbeat advance', () => {
    const cronCapture = source.match(
      /captureDurableMutation\('after_cron_heartbeat_observation', \[([\s\S]*?)\], \{[\s\S]*?operation: 'scheduled_cron_poll_observation'/,
    )

    expect(cronCapture?.[1]).toContain("'seed_poll_timestamps'")
    expect(cronCapture?.[1]).toContain("'provider_job_lifecycle'")
    expect(cronCapture?.[1]).toContain("'provider_company_health'")
    expect(cronCapture?.[1]).toContain("'pipeline_heartbeat'")
  })

  it('retains expected durable diffs while requiring temporary mutations to restore', () => {
    const entry = snapshot('2026-07-18T12:00:00.000Z', {
      activeCompanies: {
        company: {
          id: 'company',
          last_polled_at: '2026-07-18T11:00:00.000Z',
        },
      },
    })
    const envelope = createPipelineEvidenceEnvelope('invocation', 'verify-pipeline', entry)
    const polled = snapshot('2026-07-18T12:01:00.000Z', {
      activeCompanies: {
        company: {
          id: 'company',
          last_polled_at: '2026-07-18T12:01:00.000Z',
        },
      },
    })
    journalPipelineMutation(envelope, 'seed_poll_timestamps', entry, polled, {
      identifiers: ['company'],
      responseSummary: { status: 200 },
    })
    journalPipelineMutation(envelope, 'concurrent_claim_timestamps', entry, entry, {
      identifiers: ['company'],
      observed: polled,
      restorationResults: [{ id: 'company', restored: true, conflict: false }],
    })

    const result = finalizePipelineEvidenceEnvelope(envelope, polled)
    expect(result.success).toBe(true)
    expect(result.allowedDurableDiffs).toContain('activeCompanies.company.last_polled_at')
    expect(result.unexplainedDiffs).toEqual([])
  })

  it('attributes only complete provider-owned new jobs observed inside a named poll window', () => {
    const company = {
      id: 'company',
      ats_type: 'greenhouse',
      activation_state: 'active',
    }
    const entry = snapshot('2026-07-18T12:00:00.000Z', {
      activeCompanies: { company },
    })
    const inserted = snapshot('2026-07-18T12:01:00.000Z', {
      activeCompanies: { company },
      jobs: {
        job: {
          id: 'job',
          company_id: 'company',
          source: 'greenhouse',
          external_id: 'provider-1',
          title: 'Engineer',
          location: 'Chicago',
          absolute_url: 'https://example.com/jobs/provider-1',
          posted_at: '2026-07-18T11:00:00.000Z',
          description_html_hash: 'html-hash',
          description_text_hash: 'text-hash',
          snapshot_partial: false,
          fingerprint: 'fingerprint',
          status: 'open',
          first_seen_at: '2026-07-18T12:00:30.000Z',
          last_seen_at: '2026-07-18T12:00:30.000Z',
          closed_at: null,
        },
      },
    })
    const envelope = createPipelineEvidenceEnvelope('invocation', 'verify-pipeline', entry)
    journalPipelineMutation(envelope, 'provider_job_lifecycle', entry, inserted, {
      identifiers: ['company'],
      responseSummary: { claimed: 1, succeeded: 1, inserted: 1 },
    })

    const result = finalizePipelineEvidenceEnvelope(envelope, inserted)
    expect(result.success).toBe(true)
    expect(result.allowedDurableDiffs).toContain('jobs.job.external_id')
    expect(result.unexplainedDiffs).toEqual([])
  })

  it.each([
    ['unowned company', { company_id: 'other' }, { claimed: 1, succeeded: 1, inserted: 1 }],
    ['unrecognized source', { source: 'workday' }, { claimed: 1, succeeded: 1, inserted: 1 }],
    ['out-of-window first sight', { first_seen_at: '2026-07-18T11:59:59.000Z' }, { claimed: 1, succeeded: 1, inserted: 1 }],
    ['partial row', { title: null }, { claimed: 1, succeeded: 1, inserted: 1 }],
    ['missing provider activity', {}, {}],
  ])('rejects a %s instead of wildcard-allowing new job fields', (_label, overrides, responseSummary) => {
    const company = {
      id: 'company',
      ats_type: 'greenhouse',
      activation_state: 'active',
    }
    const entry = snapshot('2026-07-18T12:00:00.000Z', {
      activeCompanies: { company },
    })
    const inserted = snapshot('2026-07-18T12:01:00.000Z', {
      activeCompanies: { company },
      jobs: {
        job: {
          id: 'job',
          company_id: 'company',
          source: 'greenhouse',
          external_id: 'provider-1',
          title: 'Engineer',
          location: 'Chicago',
          absolute_url: 'https://example.com/jobs/provider-1',
          posted_at: '2026-07-18T11:00:00.000Z',
          description_html_hash: 'html-hash',
          description_text_hash: 'text-hash',
          snapshot_partial: false,
          fingerprint: 'fingerprint',
          status: 'open',
          first_seen_at: '2026-07-18T12:00:30.000Z',
          last_seen_at: '2026-07-18T12:00:30.000Z',
          closed_at: null,
          ...overrides,
        },
      },
    })
    const envelope = createPipelineEvidenceEnvelope('invocation', 'verify-pipeline', entry)
    journalPipelineMutation(envelope, 'provider_job_lifecycle', entry, inserted, {
      identifiers: ['company'],
      responseSummary,
    })

    const result = finalizePipelineEvidenceEnvelope(envelope, inserted)
    expect(result.success).toBe(false)
    expect(result.unexplainedDiffs).toContain('jobs.job.external_id')
  })

  it('blocks transient external-id rewrites of entry rows even when a later poll restores them', () => {
    const entryJob = {
      id: 'job',
      company_id: 'company',
      source: 'greenhouse',
      external_id: 'immutable-provider-id',
      title: 'Engineer',
      location: 'Chicago',
      absolute_url: 'https://example.com/jobs/immutable-provider-id',
      posted_at: '2026-07-17T11:00:00.000Z',
      description_html_hash: 'html-hash',
      description_text_hash: 'text-hash',
      snapshot_partial: false,
      fingerprint: 'fingerprint',
      status: 'open',
      first_seen_at: '2026-07-17T12:00:30.000Z',
      last_seen_at: '2026-07-18T11:00:00.000Z',
      closed_at: null,
    }
    const company = { id: 'company', ats_type: 'greenhouse', activation_state: 'active' }
    const entry = snapshot('2026-07-18T12:00:00.000Z', {
      activeCompanies: { company },
      jobs: { job: entryJob },
    })
    const rewritten = snapshot('2026-07-18T12:01:00.000Z', {
      activeCompanies: { company },
      jobs: {
        job: {
          ...entryJob,
          external_id: 'different-provider-id',
          last_seen_at: '2026-07-18T12:00:30.000Z',
        },
      },
    })
    const restored = snapshot('2026-07-18T12:02:00.000Z', {
      activeCompanies: { company },
      jobs: {
        job: {
          ...entryJob,
          last_seen_at: '2026-07-18T12:01:30.000Z',
        },
      },
    })
    const envelope = createPipelineEvidenceEnvelope('invocation', 'verify-pipeline', entry)
    journalPipelineMutation(envelope, 'provider_job_lifecycle', entry, rewritten, {
      identifiers: ['company'],
      responseSummary: { claimed: 1, succeeded: 1, inserted: 0 },
    })
    journalPipelineMutation(envelope, 'provider_job_lifecycle', rewritten, restored, {
      identifiers: ['company'],
      responseSummary: { claimed: 1, succeeded: 1, inserted: 0 },
    })

    const result = finalizePipelineEvidenceEnvelope(envelope, restored)
    expect(result.success).toBe(false)
    expect(result.immutableDrift).toContain('jobs.job.external_id')
    expect(result.unexplainedDiffs).toContain('jobs.job.external_id')
  })

  it('fails closed on CAS conflict, fixture residue, immutable drift, or unexplained diff', () => {
    const entry = snapshot('2026-07-18T12:00:00.000Z', {
      jobs: {
        job: {
          id: 'job',
          source: 'greenhouse',
          external_id: '1',
          title: 'Original title',
          first_seen_at: '2026-07-18T10:00:00.000Z',
        },
      },
    })
    const final = snapshot('2026-07-18T12:02:00.000Z', {
      jobs: {
        job: {
          id: 'job',
          source: 'greenhouse',
          external_id: '1',
          title: 'Drifted title',
          first_seen_at: '2026-07-18T10:00:00.000Z',
        },
      },
      fixtureResidue: {
        reopenMarkers: 1,
        reopenSourceKeys: 0,
        reopenReturnedJobs: 0,
        deniedRlsRows: 0,
      },
    })
    const envelope = createPipelineEvidenceEnvelope('invocation', 'verify-pipeline', entry)
    journalPipelineMutation(envelope, 'concurrent_claim_timestamps', entry, entry, {
      restorationResults: [{ id: 'company', restored: false, conflict: true }],
    })

    const result = finalizePipelineEvidenceEnvelope(envelope, final)
    expect(result.success).toBe(false)
    expect(result.restorationConflicts).toEqual(['company'])
    expect(result.residueCounts.reopenMarkers).toBe(1)
    expect(result.immutableDrift).toContain('jobs.job.title')
    expect(result.unexplainedDiffs).toContain('jobs.job.title')
  })

  it('redacts credentials and hashes large text without hiding source identities', () => {
    const redacted = redactPipelineEvidence({
      source_key: 'greenhouse:global:stripe',
      authorization: 'Bearer secret',
      cronSecret: 'cron-secret',
      user: { password: 'hunter2-secret', email: 'user@example.com' },
      description: 'x'.repeat(1_000),
    }) as Record<string, unknown>

    expect(redacted.source_key).toBe('greenhouse:global:stripe')
    expect(redacted.authorization).toBe('[REDACTED]')
    expect(redacted.cronSecret).toBe('[REDACTED]')
    expect((redacted.user as Record<string, unknown>).password).toBe('[REDACTED]')
    expect(redacted.description).toMatchObject({ redacted: 'sha256', length: 1_000 })
    expect(JSON.stringify(redacted)).not.toContain('Bearer secret')
    expect(JSON.stringify(redacted)).not.toContain('cron-secret')
    expect(JSON.stringify(redacted)).not.toContain('hunter2-secret')
  })
})

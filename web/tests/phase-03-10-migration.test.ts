import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationPath = fileURLToPath(new URL(
  '../../supabase/migrations/0048_phase_03_10_goldman_higher.sql',
  import.meta.url,
))
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : ''
const migration49Path = fileURLToPath(new URL(
  '../../supabase/migrations/0049_phase_03_10_goldman_30_day.sql',
  import.meta.url,
))
const sql49 = existsSync(migration49Path)
  ? readFileSync(migration49Path, 'utf8')
  : ''

const exactSource = 'goldman_higher:roles'
const protectedWorkdaySources = [
  'workday:wd12:capitalone:Capital_One',
  'workday:wd1:fmr:FidelityCareers',
  'workday:wd1:nasdaq:Global_External_Site',
  'workday:wd5:spgi:SPGI_Careers',
  'workday:wd5:morningstar:morningstar',
  'workday:wd1:statestreet:Global',
  'workday:wd5:ms:External',
  'workday:wd1:ghr:Lateral-US',
  'workday:wd1:blackrock:BlackRock_Professional',
  'workday:wd3:barclays:External_Career_Site_Barclays',
]

function body(name: string) {
  const match = sql.match(new RegExp(
    `create or replace function public\\.${name}\\b[\\s\\S]*?\\n\\$\\$;`,
    'i',
  ))
  expect(match, `${name} must be defined`).not.toBeNull()
  return match?.[0] ?? ''
}

describe('Phase 03.10 forward-only Goldman Higher migration', () => {
  it('is one bounded local transaction and repairs only exact Goldman identity', () => {
    expect(sql.trimStart()).toMatch(/^begin;/i)
    expect(sql.trimEnd()).toMatch(/commit;$/i)
    expect(sql).toContain("set local lock_timeout = '5s'")
    expect(sql).toContain("set local statement_timeout = '60s'")
    expect(sql).toContain("'https://higher.gs.com/results'")
    expect(sql).toContain("'Goldman Sachs'")
    expect(sql).toContain(`'${exactSource}'`)
    expect(sql).toContain("'oracle:jpmc:CX_1001'")
    expect(sql).toContain("'eightfold:morganstanley'")
    expect(sql).not.toMatch(
      /\b(drop|alter|update|delete|insert into)\s+supabase_migrations\./i,
    )
  })

  it('binds every Goldman durable field and exact SHA-256 tuple', () => {
    for (const key of [
      'sourceKey',
      'selectionMode',
      'recentHours',
      'providerSourceId',
      'providerCategoryField',
      'providerCategoryLabel',
      'matchedTerm',
      'detailCountryCode',
      'postedAt',
      'recruitingType',
      'externalIdDigest',
    ]) expect(sql).toContain(`'${key}'`)
    expect(sql).toContain("'recent_exact_us_provider_category'")
    expect(sql).toContain("'GS_EARLY_CAREER'")
    expect(sql).toContain("'GS_MID_CAREER'")
    expect(sql).toMatch(/posted_at\s*=\s*\(scope_evidence ->> 'postedAt'\)::timestamptz/)
    expect(sql).toMatch(/extensions\.digest\([\s\S]*convert_to\([\s\S]*'sha256'/)
    expect(sql).toContain("source = 'oracle_recruiting'")
    expect(sql).toContain("source = 'workday'")
  })

  it('creates a replay-safe Goldman-only service-role terminal', () => {
    const terminal = body('finalize_goldman_higher_candidate')
    expect(terminal).toMatch(/security definer[\s\S]*set search_path\s*=\s*''/i)
    expect(terminal).toContain(`p_source_key <> '${exactSource}'`)
    expect(terminal).toContain('pg_advisory_xact_lock')
    expect(terminal).toContain('replayed_evidence')
    expect(terminal).toContain('already_active')
    expect(terminal).toContain('disabled_source')
    for (const reason of [
      'navigation_identity_unverified',
      'higher_contract_unverified',
      'posting_date_ineligible',
      'population_evidence_missing',
      'category_evidence_missing',
      'country_evidence_missing',
      'application_evidence_missing',
      'pagination_incomplete',
      'count_mismatch',
      'detail_scope_incomplete',
      'job_cap_exceeded',
      'provider_timeout',
      'positive_job_count_missing',
    ]) expect(terminal).toContain(`'${reason}'`)
    expect(sql).toMatch(
      /revoke execute on function public\.finalize_goldman_higher_candidate[\s\S]*from public, anon, authenticated/,
    )
    expect(sql).toMatch(
      /grant execute on function public\.finalize_goldman_higher_candidate[\s\S]*to service_role/,
    )
    expect(sql).not.toMatch(
      /grant execute on function public\.finalize_branded_connector_candidate/,
    )
  })

  it('grants Goldman only the existing three-window and ten-minute claim contract', () => {
    const observation = body('record_connector_observation')
    const experimental = body('claim_due_experimental_connectors')
    const active = body('claim_due_companies')
    expect(observation).toContain("v_window_interval interval := interval '1 minute'")
    expect(observation).toContain('clock_timestamp()')
    expect(observation).toContain("'replay'")
    expect(observation).toContain("'same_window'")
    expect(observation).toContain('if v_progress > 3')
    expect(observation).toContain('when v_progress = 3')
    expect(observation).toContain(`v_company.source_key = '${exactSource}'`)
    expect(experimental).toContain("activation_state = 'experimental'")
    expect(experimental).toContain(`source_key = '${exactSource}'`)
    expect(experimental).toContain('for update skip locked')
    expect(active).toContain("activation_state = 'active'")
    expect(active).toContain(`source_key = '${exactSource}'`)
    expect(active).toContain("next_poll_at = v_now + interval '10 minutes'")
    for (const source of protectedWorkdaySources) {
      expect(observation + experimental + active).toContain(source)
    }
    for (const provider of [
      'greenhouse',
      'lever',
      'ashby',
      'smartrecruiters',
      'recruitee',
      'paylocity',
    ]) expect(active).toContain(`'${provider}'`)
  })

  it('hides aged Goldman rows only from Active at database time', () => {
    const feed = body('dashboard_feed_page')
    expect(feed).toContain("p_lifecycle <> 'active'")
    expect(feed).toContain("job.source <> 'goldman_higher'")
    expect(feed).toMatch(
      /job\.posted_at\s+is not null[\s\S]*job\.posted_at\s*>=\s*clock_timestamp\(\)\s*-\s*interval '168 hours'/,
    )
    expect(feed).toContain("p_lifecycle = 'applied'")
    expect(feed).toContain("p_lifecycle = 'dismissed'")
    expect(feed).toContain('user_job.user_id = (select auth.uid())')
    expect(feed).not.toMatch(/update public\.jobs/)
    expect(feed).not.toMatch(/closed_at\s*=/)
    expect(sql).toMatch(
      /grant execute on function public\.dashboard_feed_page[\s\S]*to authenticated/,
    )
  })

  it('keeps every privileged RPC service-role-only', () => {
    for (const signature of [
      'record_connector_observation',
      'claim_due_experimental_connectors',
      'claim_due_companies',
    ]) {
      expect(sql).toMatch(new RegExp(
        `revoke execute on function public\\.${signature}[\\s\\S]*?from public, anon, authenticated`,
      ))
      expect(sql).toMatch(new RegExp(
        `grant execute on function public\\.${signature}[\\s\\S]*?to service_role`,
      ))
    }
  })
})

describe('Phase 03.10 forward-only Goldman 30-day migration', () => {
  it('is one bounded transaction and never rewrites migration history', () => {
    expect(sql49.trimStart()).toMatch(/^begin;/i)
    expect(sql49.trimEnd()).toMatch(/commit;$/i)
    expect(sql49).toContain("set local lock_timeout = '5s'")
    expect(sql49).toContain("set local statement_timeout = '60s'")
    expect(sql49).not.toMatch(
      /\b(drop|alter|update|delete|insert into)\s+supabase_migrations\./i,
    )
  })

  it('replaces exactly the Goldman 168-hour evidence and digest constants', () => {
    expect(sql49).toContain(
      "(scope_evidence -> ''recentHours''::text) = ''168''::jsonb",
    )
    expect(sql49).toContain(
      "(scope_evidence -> ''recentHours''::text) = ''720''::jsonb",
    )
    expect(sql49).toContain("'to_json(168)::text'")
    expect(sql49).toContain("'to_json(720)::text'")
    expect(sql49).toContain('jobs_scope_evidence_check')
    expect(sql49).toContain('pg_get_constraintdef')
  })

  it('widens only Active Goldman feed visibility to 720 hours', () => {
    expect(sql49).toContain(
      'public.dashboard_feed_page(text,text,text[],text[],text,jsonb,integer)',
    )
    expect(sql49).toContain("'interval ''168 hours'''")
    expect(sql49).toContain("'interval ''720 hours'''")
    expect(sql49).toContain('pg_get_functiondef')
  })

  it('refreshes only the exact posting-date-ineligible Goldman candidate', () => {
    expect(sql49).toContain("company_name = 'Goldman Sachs'")
    expect(sql49).toContain("provider = 'Goldman Higher'")
    expect(sql49).toContain("careers_url = 'https://higher.gs.com/results'")
    expect(sql49).toContain("disposition = 'unsupported_with_reason'")
    expect(sql49).toContain("unsupported_reason = 'posting_date_ineligible'")
    expect(sql49).toContain('rolling 30-day posting window')
    expect(sql49).not.toMatch(/\bset\s+disposition\s*=/i)
    expect(sql49).not.toMatch(/\bset\s+unsupported_reason\s*=/i)
    expect(sql49).not.toMatch(/\bset\s+source_key\s*=/i)
    expect(sql49).toContain('if v_rows <> 1')
  })
})

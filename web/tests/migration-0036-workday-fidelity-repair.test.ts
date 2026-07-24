import { describe, expect, it } from 'vitest'

import migration0036 from '../../supabase/migrations/0036_workday_fidelity_integrity_repair.sql?raw'

const CAPITAL_ONE_KEY = 'workday:wd12:capitalone:Capital_One'
const FIDELITY_KEY = 'workday:wd1:fmr:FidelityCareers'

describe('migration 0036 — Workday identity and Fidelity fingerprint integrity', () => {
  it('is a forward-only transaction that replaces only the bypassable Workday check', () => {
    expect(migration0036).toMatch(/^\s*begin\s*;/i)
    expect(migration0036).toMatch(/\bcommit\s*;\s*$/i)
    expect(migration0036).toMatch(
      /alter table public\.companies[\s\S]*drop constraint companies_workday_identity_check[\s\S]*add constraint companies_workday_identity_check check/i,
    )
    expect(migration0036).not.toMatch(/\b(?:drop|truncate)\s+table\b/i)
    expect(migration0036).not.toMatch(/\binsert into public\.jobs\b/i)
    expect(migration0036).not.toMatch(
      /\b(?:drop|add)\s+constraint\s+(?:companies_source_key_key|jobs_source_external_id_key)\b/i,
    )
  })

  it('requires the exact two-tuple Workday branch itself to be true', () => {
    const identityCheck = migration0036.match(
      /add constraint companies_workday_identity_check check \(([\s\S]*?)\n {2}\);/i,
    )?.[1] ?? ''

    expect(identityCheck).toContain("board_token = 'capitalone'")
    expect(identityCheck).toContain("region = 'wd12'")
    expect(identityCheck).toContain("site_token = 'Capital_One'")
    expect(identityCheck).toContain(`source_key = '${CAPITAL_ONE_KEY}'`)
    expect(identityCheck).toContain("board_token = 'fmr'")
    expect(identityCheck).toContain("region = 'wd1'")
    expect(identityCheck).toContain("site_token = 'FidelityCareers'")
    expect(identityCheck).toContain(`source_key = '${FIDELITY_KEY}'`)
    expect(identityCheck).toMatch(
      /or\s*\(\s*\([\s\S]*capitalone[\s\S]*\)\s*or\s*\([\s\S]*FidelityCareers[\s\S]*\)\s*\)\s+is true\s*$/i,
    )
  })

  it('transactionally exercises NULL region and NULL site_token against public.companies', () => {
    expect(migration0036).toMatch(
      /update public\.companies[\s\S]*set region = null[\s\S]*source_key = 'workday:wd12:capitalone:Capital_One'/i,
    )
    expect(migration0036).toMatch(
      /insert into public\.companies[\s\S]*'capitalone'[\s\S]*null[\s\S]*'Capital_One'[\s\S]*'workday:wd12:capitalone:Capital_One'/i,
    )
    expect(migration0036).toMatch(
      /update public\.companies[\s\S]*set site_token = null[\s\S]*source_key = 'workday:wd1:fmr:FidelityCareers'/i,
    )
    expect(migration0036).toMatch(
      /insert into public\.companies[\s\S]*'fmr'[\s\S]*'wd1'[\s\S]*null[\s\S]*'workday:wd1:fmr:FidelityCareers'/i,
    )
    expect((migration0036.match(/when check_violation then/gi) ?? []).length)
      .toBeGreaterThanOrEqual(3)
  })

  it('transactionally rejects an unknown fully non-null Workday tuple', () => {
    expect(migration0036).toMatch(
      /insert into public\.companies[\s\S]*'workday'[\s\S]*'migration-probe-'[\s\S]*'wd99'[\s\S]*'Unknown_Site'[\s\S]*'workday:wd99:migration-probe-'/i,
    )
    expect(migration0036).toMatch(
      /raise exception 'unknown Workday tuple unexpectedly passed companies_workday_identity_check'/i,
    )
  })

  it('repairs only the exact Fidelity company identity and fails on an unexpected name', () => {
    expect(migration0036).toMatch(
      /if exists \([\s\S]*from public\.companies[\s\S]*source_key = 'workday:wd1:fmr:FidelityCareers'[\s\S]*name not in \('fmr', 'Fidelity'\)[\s\S]*raise exception/i,
    )
    expect(migration0036).toMatch(
      /update public\.companies[\s\S]*set name = 'Fidelity'[\s\S]*source_key = 'workday:wd1:fmr:FidelityCareers'[\s\S]*name = 'fmr'/i,
    )
    expect(migration0036).not.toMatch(
      /update public\.companies[\s\S]*set[\s\S]*activation_state\s*=/i,
    )
    expect(migration0036).not.toMatch(/delete from public\.companies/i)
  })

  it('fails before repair if an exact-key-linked Fidelity job has an unknown fingerprint prefix', () => {
    expect(migration0036).toMatch(
      /if exists \([\s\S]*from public\.jobs as j[\s\S]*join public\.companies as c[\s\S]*c\.source_key = 'workday:wd1:fmr:FidelityCareers'[\s\S]*j\.fingerprint not like 'fmr\|%'[\s\S]*j\.fingerprint not like 'fidelity\|%'[\s\S]*raise exception/i,
    )
  })

  it('repairs source company names and only the proven fingerprint prefix while preserving the suffix', () => {
    const jobRepair = migration0036.match(
      /update public\.jobs as j\s+set([\s\S]*?)\s+from public\.companies as c[\s\S]*?c\.source_key = 'workday:wd1:fmr:FidelityCareers'/i,
    )?.[1] ?? ''

    expect(jobRepair).toMatch(/source_company_name = 'Fidelity'/i)
    expect(jobRepair).toMatch(
      /when j\.fingerprint like 'fmr\|%'\s+then 'fidelity\|' \|\| substring\(j\.fingerprint from 5\)/i,
    )
    expect(jobRepair).toMatch(
      /when j\.fingerprint like 'fidelity\|%'\s+then j\.fingerprint/i,
    )
    expect(jobRepair).not.toMatch(/\b(?:title|location|source|external_id|company_id)\s*=/i)
  })

  it('asserts final company and linked-job parity without manual repair instructions', () => {
    expect(migration0036).toMatch(
      /raise exception 'Fidelity company-name repair parity failed'/i,
    )
    expect(migration0036).toMatch(
      /raise exception 'Fidelity job repair parity failed'/i,
    )
    expect(migration0036).toMatch(
      /j\.source_company_name is distinct from 'Fidelity'/i,
    )
    expect(migration0036).not.toMatch(/\bmanual(?:ly)?\b/i)
  })
})

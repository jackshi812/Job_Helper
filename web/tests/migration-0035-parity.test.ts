import { describe, expect, it } from 'vitest'

// ?raw import of the forward-only migration authored by plan 03.5-03. This file
// does not exist until Task 2 authors it, so this import fails first — RED.
// Mirrors the ?raw + regex-assert style used in workday-connector.integration.test.ts.
import migration0035 from '../../supabase/migrations/0035_generic_workday_fidelity.sql?raw'

const CAPITAL_ONE_KEY = 'workday:wd12:capitalone:Capital_One'
const FIDELITY_KEY = 'workday:wd1:fmr:FidelityCareers'

describe('migration 0035 — generic Workday / Fidelity admission (forward-only, authored not applied)', () => {
  it('is forward-only: never edits deployed migration objects via DROP FUNCTION or table recreation', () => {
    // 0035 relaxes via ALTER ... DROP/ADD CONSTRAINT and CREATE OR REPLACE only.
    expect(migration0035).toMatch(/create or replace function public\.claim_due_companies/i)
    // It must not carry an INSERT into companies (identities are admitted, not seeded here).
    expect(migration0035).not.toMatch(/insert into public\.companies/i)
  })

  it('relaxes companies_region_check to admit workday wd1 while keeping lever-eu and null', () => {
    const regionCheck = migration0035.match(
      /add constraint companies_region_check check \(([\s\S]*?)\n {2}\)/i,
    )?.[1] ?? ''
    expect(migration0035).toMatch(/drop constraint companies_region_check/i)
    // Still admits null and the lever eu case.
    expect(regionCheck).toMatch(/region is null/i)
    expect(regionCheck).toMatch(/ats_type = 'lever' and region = 'eu'/i)
    // Widened to admit workday wd-numbered regions (wd1 for Fidelity, wd12 for Capital One).
    expect(regionCheck).toMatch(/ats_type = 'workday'[\s\S]*region ~ '\^wd\\d\+\$'/i)
  })

  it('relaxes the identity check to an allowlist that keeps Capital One byte-identical and adds Fidelity', () => {
    const identityCheck = migration0035.match(
      /add constraint companies_workday_identity_check check \(([\s\S]*?)\n {2}\)/i,
    )?.[1] ?? ''
    expect(migration0035).toMatch(/drop constraint companies_workday_identity_check/i)
    // Capital One tuple admitted byte-identically.
    expect(identityCheck).toContain("board_token = 'capitalone'")
    expect(identityCheck).toContain("region = 'wd12'")
    expect(identityCheck).toContain("site_token = 'Capital_One'")
    expect(identityCheck).toContain(`source_key = '${CAPITAL_ONE_KEY}'`)
    // Fidelity tuple added.
    expect(identityCheck).toContain("board_token = 'fmr'")
    expect(identityCheck).toContain("region = 'wd1'")
    expect(identityCheck).toContain("site_token = 'FidelityCareers'")
    expect(identityCheck).toContain(`source_key = '${FIDELITY_KEY}'`)
    // Both admitted in experimental or active.
    expect(identityCheck).toMatch(/activation_state in \('experimental', 'active'\)/i)
  })

  it('does NOT copy 0028 zero-pre-existing-workday-jobs guard (Capital One is live in prod)', () => {
    // No "count(*) ... jobs ... = 0" style guard and no exception on pre-existing workday jobs.
    expect(migration0035).not.toMatch(/from public\.jobs where source = 'workday'/i)
    expect(migration0035).not.toMatch(/requires zero pre-existing workday jobs/i)
  })

  it('wires Fidelity into the 3-window auto-promotion via the RPC stable-promotion set', () => {
    // record_connector_observation stable-promotion branch must include workday at progress = 3.
    expect(migration0035).toMatch(/create or replace function public\.record_connector_observation/i)
    const promoteSet = migration0035.match(
      /when v_progress = 3\b([\s\S]*?)then 'active'/i,
    )?.[1] ?? ''
    expect(promoteSet).toMatch(/ats_type in \([^)]*'workday'[^)]*\)/i)
    // Capital One's dedicated promotion trigger must remain untouched (not redefined/dropped here).
    expect(migration0035).not.toMatch(/create or replace function public\.promote_capital_one_after_observation/i)
    expect(migration0035).not.toMatch(/drop trigger if exists promote_capital_one_after_observation/i)
  })

  it('widens claim_due_companies to admit the Fidelity/allowlist disjunct while keeping Capital One', () => {
    const claimSql = migration0035.match(
      /create or replace function public\.claim_due_companies[\s\S]*?as \$\$([\s\S]*?)\$\$;/i,
    )?.[1] ?? ''
    expect(claimSql).toContain(CAPITAL_ONE_KEY)
    expect(claimSql).toContain(FIDELITY_KEY)
    expect(claimSql).toMatch(/for update skip locked/i)
    expect(claimSql).toMatch(/last_polled_at < now\(\) - interval '9 minutes'/i)
  })

  it('UPDATEs (never INSERTs) the Fidelity source_coverage_catalog row to experimental', () => {
    // There must be an UPDATE of the catalog for Fidelity.
    expect(migration0035).toMatch(
      /update (public\.)?source_coverage_catalog[\s\S]*?where company_name = 'Fidelity'/i,
    )
    // And absolutely no INSERT into the catalog (UNIQUE company_name + truthful_disposition_check).
    expect(migration0035).not.toMatch(/insert into public\.source_coverage_catalog/i)
    // The UPDATE sets the truthful experimental shape: experimental + non-null source_key + null reason.
    expect(migration0035).toMatch(/set[\s\S]*disposition = 'experimental'/i)
    expect(migration0035).toContain(`source_key = '${FIDELITY_KEY}'`)
    expect(migration0035).toMatch(/unsupported_reason = null/i)
  })

  it('pins Capital One parity assertions (catalog + identity) in a DO-block', () => {
    // Capital One key appears in identity allowlist, claim, and parity assertions.
    expect((migration0035.match(new RegExp(CAPITAL_ONE_KEY, 'g')) ?? []).length)
      .toBeGreaterThanOrEqual(2)
    expect(migration0035).toContain("c.conname = 'companies_workday_identity_check'")
  })
})

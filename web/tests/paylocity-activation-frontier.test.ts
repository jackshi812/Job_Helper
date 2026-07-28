import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationsDirectory = fileURLToPath(new URL(
  '../../supabase/migrations/',
  import.meta.url,
))
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((file) => /^\d{4}_.+\.sql$/.test(file))
  .sort()

function observationDefinition(sql: string) {
  return sql.match(
    /create or replace function public\.record_connector_observation\([\s\S]*?\n\$\$;/i,
  )?.[0] ?? null
}

const observationFrontiers = migrationFiles.flatMap((file) => {
  const sql = readFileSync(`${migrationsDirectory}/${file}`, 'utf8')
  const definition = observationDefinition(sql)
  return definition ? [{ file, definition, sql }] : []
})
const latest = observationFrontiers.at(-1)
const previous = observationFrontiers.at(-2)

function position(definition: string, pattern: RegExp) {
  const match = definition.match(pattern)
  expect(match, `expected final RPC to match ${pattern}`).not.toBeNull()
  return match?.index ?? -1
}

describe('Paylocity activation at the migration frontier', () => {
  it('keeps the repair as the final forward-only RPC definition', () => {
    expect(latest?.file).toBe('0057_restore_paylocity_staged_activation.sql')
    expect(previous?.file).toBe('0048_phase_03_10_goldman_higher.sql')
    expect(latest?.sql.trimStart()).toMatch(/^begin;/i)
    expect(latest?.sql.trimEnd()).toMatch(/commit;$/i)
    expect(latest?.sql).not.toMatch(
      /\b(drop|alter|update|delete|insert into)\s+supabase_migrations\./i,
    )

    const replacedFunctions = [
      ...latest!.sql.matchAll(
        /create or replace function public\.([a-z0-9_]+)\s*\(/gi,
      ),
    ].map(([, name]) => name)
    expect(replacedFunctions).toEqual(['record_connector_observation'])
  })

  it('admits only the exact Experimental Paylocity identity', () => {
    const definition = latest!.definition
    expect(definition).toMatch(
      /activation_state\s*<>\s*'experimental'[\s\S]*ats_type\s*=\s*'paylocity'[\s\S]*source_key\s*=\s*[\r\n\s]*'paylocity:global:d6628b21-949b-4400-a3d0-c9082bbf3eb1'[\s\S]*board_token\s*=\s*'d6628b21-949b-4400-a3d0-c9082bbf3eb1'[\s\S]*region\s+is\s+null[\s\S]*site_token\s+is\s+null/i,
    )
    expect(definition.match(/v_company\.ats_type\s*=\s*'paylocity'/gi))
      .toHaveLength(2)
    expect(latest!.sql).not.toMatch(
      /alter table public\.(?:companies|connector_observations)/i,
    )
  })

  it('accepts only positive clean evidence in separate server-timed windows', () => {
    const definition = latest!.definition
    const validation = position(
      definition,
      /p_completeness\s*<>\s*'complete'[\s\S]*p_credible_for_closure\s+is not true[\s\S]*p_job_count\s+is null\s+or p_job_count\s*<=\s*0[\s\S]*p_job_count\s*<>\s*p_expected_count[\s\S]*p_warning_count\s*<>\s*0[\s\S]*p_evidence_digest\s*!~\s*'\^\[0-9a-f\]\{64\}\$'/i,
    )
    const identity = position(definition, /v_company\.ats_type\s*=\s*'paylocity'/i)
    const insert = position(definition, /insert into public\.connector_observations/i)
    expect(validation).toBeLessThan(identity)
    expect(identity).toBeLessThan(insert)
    expect(definition).toMatch(
      /when v_company\.ats_type\s*=\s*'paylocity' then interval '10 minutes'[\s\S]*date_bin\(\s*v_window_interval,\s*v_now/i,
    )
    expect(definition).not.toMatch(
      /p_(?:observed_at|window_start|timestamp|now)\b/i,
    )
    expect(definition).toContain('clock_timestamp()')
  })

  it('rejects replay and same-window evidence before the ledger can advance', () => {
    const definition = latest!.definition
    const cap = position(
      definition,
      /v_company\.activation_successes\s*>=\s*3/i,
    )
    const replay = position(
      definition,
      /where observation_id\s*=\s*p_observation_id[\s\S]*'replay'/i,
    )
    const sameWindow = position(
      definition,
      /where company_id\s*=\s*p_company_id[\s\S]*eligibility_window_start\s*=\s*v_window_start[\s\S]*'same_window'/i,
    )
    const insert = position(definition, /insert into public\.connector_observations/i)
    expect(cap).toBeLessThan(replay)
    expect(replay).toBeLessThan(sameWindow)
    expect(sameWindow).toBeLessThan(insert)
  })

  it('promotes the exact row on its third clean window and exposes only service-role execution', () => {
    const definition = latest!.definition
    expect(definition).toMatch(
      /select count\(\*\)::integer into v_progress[\s\S]*where company_id\s*=\s*p_company_id/i,
    )
    expect(definition).toMatch(
      /activation_successes\s*=\s*v_progress[\s\S]*activation_state\s*=\s*case when v_progress\s*=\s*3 then 'active'/i,
    )
    expect(definition).toMatch(
      /when v_progress\s*=\s*3 then v_now[\s\S]*else v_next_eligible_at/i,
    )
    expect(latest!.sql).toMatch(
      /revoke execute on function public\.record_connector_observation\([\s\S]*?\) from public, anon, authenticated/i,
    )
    expect(latest!.sql).toMatch(
      /grant execute on function public\.record_connector_observation\([\s\S]*?\) to service_role/i,
    )
  })

  it('does not widen or change any pre-existing provider admission', () => {
    const paylocityAdmission = /\n      or \(\n        v_company\.ats_type = 'paylocity'[\s\S]*?v_company\.site_token is null\n      \)/
    const paylocityWindow = /\n  v_window_interval := case\n    when v_company\.ats_type = 'paylocity' then interval '10 minutes'\n    else interval '1 minute'\n  end;/
    const repairedWithoutPaylocity = latest!.definition
      .replace('v_window_interval interval;', "v_window_interval interval := interval '1 minute';")
      .replace(paylocityAdmission, '')
      .replace(paylocityWindow, '')
    expect(repairedWithoutPaylocity).toBe(previous!.definition)
  })
})

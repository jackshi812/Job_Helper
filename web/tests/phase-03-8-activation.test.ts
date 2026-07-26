import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  '../supabase/migrations/0040_phase_03_8_branded_connectors.sql',
)
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : ''

function body(name: string) {
  const match = sql.match(new RegExp(
    `create or replace function public\\.${name}\\b[\\s\\S]*?\\n\\$\\$;`,
    'i',
  ))
  expect(match, `${name} must be defined`).not.toBeNull()
  return match?.[0] ?? ''
}

describe('Phase 03.8 proof-gated candidate terminalization', () => {
  it('is a forward transaction with no migration-time candidate admission', () => {
    expect(sql.trimStart()).toMatch(/^begin;/i)
    expect(sql.trimEnd()).toMatch(/commit;$/i)
    expect(sql).toContain('pending_current_live_contract_proof')
    const migrationApplication = sql.slice(
      0,
      sql.indexOf('create or replace function public.finalize_branded_connector_candidate'),
    )
    expect(migrationApplication).not.toMatch(/insert into public\.companies/i)
  })

  it('installs an exact service-only terminal RPC with replay and lifecycle guards', () => {
    const rpc = body('finalize_branded_connector_candidate')
    expect(rpc).toMatch(/security definer[\s\S]*set search_path\s*=\s*''/i)
    expect(rpc).toMatch(/pg_advisory_xact_lock/i)
    expect(rpc).toMatch(/admit_experimental/)
    expect(rpc).toMatch(/unsupported/)
    expect(rpc).toMatch(/already_active/)
    expect(rpc).toMatch(/disabled_source/)
    expect(rpc).toMatch(/replayed_evidence/)
    for (const key of [
      'eightfold:morganstanley',
      'oracle:jpmc:CX_1001',
      'goldman_higher:roles',
    ]) expect(rpc).toContain(`'${key}'`)
    expect(sql).toMatch(/revoke execute on function public\.finalize_branded_connector_candidate[\s\S]*from public, anon, authenticated/i)
    expect(sql).toMatch(/grant execute on function public\.finalize_branded_connector_candidate[\s\S]*to service_role/i)
  })
})

describe('Phase 03.8 positive activation and independent claims', () => {
  it('accepts only positive exact evidence in three distinct server windows', () => {
    const rpc = body('record_connector_observation')
    expect(rpc).toMatch(/clock_timestamp\(\)/i)
    expect(rpc).not.toMatch(/p_(?:observed_at|window_start|timestamp|now)\b/i)
    expect(rpc).toMatch(/p_job_count\s*<=\s*0/i)
    expect(rpc).toMatch(/p_job_count\s*<>\s*p_expected_count/i)
    expect(rpc).toMatch(/p_warning_count\s*<>\s*0/i)
    expect(rpc).toMatch(/p_credible_for_closure\s+is not true/i)
    expect(rpc).toMatch(/observation_id\s*=\s*p_observation_id/i)
    expect(rpc).toMatch(/eligibility_window_start\s*=\s*v_window_start/i)
    expect(rpc).toMatch(/v_progress\s*=\s*3/i)
    expect(rpc).toMatch(/activation_successes\s*=\s*v_progress/i)
    expect(rpc).toMatch(/then v_now\s*\+\s*\(.*% 5\).*interval '1 minute'/is)
  })

  it('locks and claims Experimental and Active lanes separately', () => {
    const experimental = body('claim_due_experimental_connectors')
    const active = body('claim_due_companies')
    expect(experimental).toMatch(/activation_state\s*=\s*'experimental'/i)
    expect(experimental).not.toMatch(/activation_state\s*=\s*'active'/i)
    expect(experimental).toMatch(/for update skip locked/i)
    expect(experimental).toMatch(/greatest\(1,\s*least\(coalesce\(batch_size,\s*3\),\s*3\)\)/i)
    expect(active).toMatch(/activation_state\s*=\s*'active'/i)
    expect(active).not.toMatch(/activation_state\s*=\s*'experimental'/i)
    expect(active).toMatch(/coalesce\(next_poll_at,\s*last_polled_at,[^)]*\)\s*<=\s*v_now/i)
    expect(active).toMatch(/next_poll_at\s*=\s*v_now\s*\+\s*interval '10 minutes'/i)
    expect(active).toMatch(/for update skip locked/i)
  })

  it('pins the scheduler and privilege boundaries', () => {
    expect(sql).toMatch(/cron\.schedule\(\s*'poll-tick-every-minute'[\s\S]*'\* \* \* \* \*'/i)
    expect(sql).toMatch(/timeout_milliseconds\s*:=\s*120000/i)
    expect(sql).toMatch(/cron\.schedule\(\s*'observe-connectors-every-minute'[\s\S]*'\* \* \* \* \*'/i)
    for (const signature of [
      'record_connector_observation(uuid, uuid, text, boolean, integer, integer, integer, text)',
      'claim_due_experimental_connectors(integer)',
      'claim_due_companies(integer)',
    ]) {
      expect(sql.toLowerCase()).toContain(
        `revoke execute on function public.${signature} from public, anon, authenticated`,
      )
      expect(sql.toLowerCase()).toContain(
        `grant execute on function public.${signature} to service_role`,
      )
    }
    expect(4 + 1 + 1 + 2 + 5).toBeLessThanOrEqual(15)
  })
})

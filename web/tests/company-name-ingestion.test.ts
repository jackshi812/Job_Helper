import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mapAdzunaResult } from '../../supabase/functions/_shared/adapters/adzuna'

const root = fileURLToPath(new URL('../..', import.meta.url))
const migrationPath = `${root}/supabase/migrations/0025_scoring_freshness.sql`
const discoveryPath = `${root}/supabase/functions/discovery-sweep/index.ts`
const pollPath = `${root}/supabase/functions/poll-tick/index.ts`

describe('truthful company-name ingestion', () => {
  it('normalizes Adzuna provider names but leaves missing names null', () => {
    const named = mapAdzunaResult({
      id: 1,
      title: 'Equity Research Analyst',
      redirect_url: 'https://example.com/1',
      company: { display_name: '  Example Capital  ' },
    })
    const missing = mapAdzunaResult({
      id: 2,
      title: 'Equity Research Associate',
      redirect_url: 'https://example.com/2',
      company: { display_name: '   ' },
    })
    expect(named.companyName).toBe('Example Capital')
    expect(missing.companyName).toBeNull()
  })

  it('persists bounded Adzuna source company names on insert and exact refresh', () => {
    const source = readFileSync(discoveryPath, 'utf8')
    expect(source).toMatch(/sourceCompanyName\s*=\s*normalized\.companyName\?\.trim\(\)\.slice\(0, 200\)\s*\|\|\s*null/i)
    expect(source.match(/source_company_name:\s*sourceCompanyName/gi)?.length)
      .toBeGreaterThanOrEqual(2)
    const exactBranch = source.match(/if \(exactAction !== 'insert'[\s\S]*?continue\n\s*}/)?.[0]
    expect(exactBranch).toMatch(/source_company_name:\s*sourceCompanyName/i)
  })

  it('backfills joined names and retains tracked Greenhouse Ashby company identity', () => {
    expect(existsSync(migrationPath), 'migration 0025 must exist').toBe(true)
    if (!existsSync(migrationPath)) return
    const sql = readFileSync(migrationPath, 'utf8')
    const poll = readFileSync(pollPath, 'utf8')
    expect(sql).toMatch(/add column source_company_name text/i)
    expect(sql).toMatch(/update public\.jobs[\s\S]*source_company_name\s*=\s*left\(btrim\(c\.name\),\s*200\)/i)
    expect(sql).toMatch(/from public\.companies(?:\s+as)?\s+c[\s\S]*j\.company_id\s*=\s*c\.id/i)
    expect(poll).toMatch(/company_id:\s*company\.id/i)
    expect(poll).not.toMatch(/source_company_name:\s*['"`][^'"`]+['"`]/i)
  })
})

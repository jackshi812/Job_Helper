import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))
const handlerPath = `${root}/supabase/functions/route-dashboard-resumes/index.ts`
const read = () => readFileSync(handlerPath, 'utf8')

describe('dashboard resume routing Edge boundary', () => {
  it('exists and authenticates before constructing service authority', () => {
    expect(existsSync(handlerPath)).toBe(true)
    const source = read()
    const auth = source.indexOf('.auth.getUser(token)')
    const role = source.indexOf("role !== 'authenticated'")
    const service = source.indexOf('dependencies.createServiceClient()')
    expect(auth).toBeGreaterThanOrEqual(0)
    expect(role).toBeGreaterThan(auth)
    expect(service).toBeGreaterThan(role)
    expect(source).toContain("requiredEnvironment('SUPABASE_ANON_KEY')")
    expect(source).not.toContain("requiredEnvironment('SUPABASE_PUBLISHABLE_KEY')")
  })

  it('validates a bounded UUID page and reuses pure routeResume', () => {
    const source = read()
    expect(source).toContain('user_job_ids')
    expect(source).toMatch(/length > 200/)
    expect(source).toContain('new Set')
    expect(source).toContain('routeResume(')
    expect(source).toContain("'publish_resume_route_page'")
    expect(source).toContain('}, 409)')
  })

  it('has no AI, ranking, or private-content output capability', () => {
    const source = read()
    expect(source).not.toMatch(/generateStructured|OPENAI|enqueue_deterministic|finalize_deterministic/)
    expect(source).not.toMatch(/console\.(?:log|error)/)
    expect(source).not.toMatch(/text_content/)
  })
})

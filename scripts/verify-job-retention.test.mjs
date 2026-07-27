import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationPath = new URL(
  '../supabase/migrations/0049_job_retention_and_permanent_user_dismissal.sql',
  import.meta.url,
)
const sql = await readFile(migrationPath, 'utf8')

test('dismissal tombstones bind one user to a stable provider identity', () => {
  assert.match(sql, /create table public\.user_job_dismissals/i)
  assert.match(sql, /user_id uuid not null references auth\.users \(id\) on delete cascade/i)
  assert.match(sql, /source text not null/i)
  assert.match(sql, /external_id text not null/i)
  assert.match(sql, /primary key \(user_id, source, external_id\)/i)
})

test('dismissal tombstones are private and not directly writable by users', () => {
  assert.match(sql, /alter table public\.user_job_dismissals enable row level security/i)
  assert.match(
    sql,
    /revoke all on table public\.user_job_dismissals from public, anon, authenticated/i,
  )
  assert.doesNotMatch(sql, /grant (?:insert|update|delete).*user_job_dismissals.*authenticated/i)
})

test('existing dismissed projections become compact tombstones and are deleted', () => {
  assert.match(
    sql,
    /insert into public\.user_job_dismissals[\s\S]+where user_job\.dismissed_at is not null/i,
  )
  assert.match(sql, /delete from public\.user_jobs\s+where dismissed_at is not null/i)
})

test('all future projection inserts fail closed for a dismissed provider identity', () => {
  assert.match(sql, /create trigger prevent_dismissed_user_job_reinsert/i)
  assert.match(sql, /before insert on public\.user_jobs/i)
  assert.match(
    sql,
    /dismissal\.user_id = new\.user_id[\s\S]+dismissal\.source = job\.source[\s\S]+dismissal\.external_id = job\.external_id/i,
  )
  assert.match(sql, /then\s+return null;/i)
})

test('permanent dismissal is authenticated, user-scoped, and never deletes shared jobs', () => {
  const functionSql = sql.match(
    /create function public\.dismiss_job_permanently[\s\S]+?\n\$\$;/i,
  )?.[0] ?? ''
  assert.match(functionSql, /owner_id uuid := \(select auth\.uid\(\)\)/i)
  assert.match(functionSql, /user_job\.user_id = owner_id/i)
  assert.match(functionSql, /insert into public\.user_job_dismissals/i)
  assert.match(
    functionSql,
    /delete from public\.user_jobs[\s\S]+user_id = owner_id/i,
  )
  assert.doesNotMatch(functionSql, /delete from public\.jobs/i)
})

test('retention permanently deletes only closed jobs aged seven days', () => {
  assert.match(sql, /delete from public\.jobs as job/i)
  assert.match(sql, /job\.status = 'closed'/i)
  assert.match(sql, /job\.closed_at is not null/i)
  assert.match(
    sql,
    /job\.closed_at <= clock_timestamp\(\) - interval '7 days'/i,
  )
})

test('retention preserves a closed job if any user marked it applied', () => {
  assert.match(
    sql,
    /not exists \([\s\S]+user_job\.job_id = job\.id[\s\S]+user_job\.applied_at is not null[\s\S]+\)/i,
  )
})

test('retention runs once daily and is not callable by authenticated users', () => {
  assert.match(sql, /'purge-closed-unapplied-jobs-daily'/i)
  assert.match(sql, /'17 4 \* \* \*'/i)
  assert.match(
    sql,
    /revoke execute on function public\.purge_closed_unapplied_jobs\(\)\s+from public, anon, authenticated/i,
  )
  assert.match(
    sql,
    /grant execute on function public\.purge_closed_unapplied_jobs\(\)\s+to service_role/i,
  )
})

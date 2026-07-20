import { describe, expect, it } from 'vitest'
import migrationSql from '../../supabase/migrations/0024_remove_notifications.sql?raw'

describe('notification removal migration', () => {
  it('stops delivery work and removes notification persistence', () => {
    expect(migrationSql).toMatch(/cron\.unschedule\(jobid\)/i)
    expect(migrationSql).toMatch(/jobname\s*=\s*'notify-tick-every-minute'/i)
    expect(migrationSql).toMatch(/drop function if exists public\.claim_notifications\(text, integer\)/i)
    expect(migrationSql).toMatch(/drop table if exists public\.notifications/i)
    expect(migrationSql).toMatch(/drop table if exists public\.push_subscriptions/i)
  })

  it('removes alert tuning fields and leaves account deletion feed-only', () => {
    for (const column of [
      'last_digest_date',
      'notify_threshold',
      'quiet_start',
      'quiet_end',
      'digest_time',
      'timezone',
    ]) {
      expect(migrationSql).toMatch(new RegExp(`drop column if exists ${column}`, 'i'))
    }

    const deleteFunction = migrationSql.match(
      /create or replace function public\.delete_my_data\(\)[\s\S]*?\$\$;/i,
    )?.[0]
    expect(deleteFunction).toBeDefined()
    expect(deleteFunction).not.toMatch(/notifications|push_subscriptions/i)
    expect(deleteFunction).toMatch(/delete from public\.user_jobs/i)
  })
})

import { describe, expect, it } from 'vitest'
import migration0053 from '../../supabase/migrations/0053_application_tracker.sql?raw'

const STAGES = [
  'ready_to_apply',
  'applied',
  'outreach_sent',
  'interview',
  'offer',
  'rejected',
] as const

function functionBody(name: string) {
  return migration0053.match(
    new RegExp(`create (?:or replace )?function public\\.${name}[\\s\\S]*?\\$\\$;`, 'i'),
  )?.[0] ?? ''
}

describe('migration 0053 — application tracker', () => {
  it('is a forward-only transaction with the two owner-scoped tables', () => {
    expect(migration0053).toMatch(/^\s*begin\s*;/i)
    expect(migration0053).toMatch(/\bcommit\s*;\s*$/i)
    expect(migration0053).toMatch(/create table public\.applications/i)
    expect(migration0053).toMatch(/create table public\.application_stage_events/i)
    expect(migration0053).not.toMatch(/\b(?:drop|truncate)\s+table\b/i)
    expect(migration0053).toMatch(/alter table public\.applications enable row level security/i)
    expect(migration0053).toMatch(/alter table public\.application_stage_events enable row level security/i)
    expect(migration0053).toMatch(/policy "applications_select_own"/i)
    expect(migration0053).toMatch(/policy "application_stage_events_select_own"/i)
    expect(migration0053).toMatch(/create index applications_user_id_idx/i)
    expect(migration0053).toMatch(/create index application_stage_events_user_id_idx/i)
  })

  it('uses exactly the six locked tracker stage slugs', () => {
    const stageConstraint = migration0053.match(
      /constraint applications_stage_check check \(\s*current_stage in \(([\s\S]*?)\)\s*\)/i,
    )?.[1] ?? ''
    const eventConstraint = migration0053.match(
      /constraint application_stage_events_stage_check check \(\s*stage in \(([\s\S]*?)\)\s*\)/i,
    )?.[1] ?? ''
    for (const stage of STAGES) {
      expect(stageConstraint).toContain(`'${stage}'`)
      expect(eventConstraint).toContain(`'${stage}'`)
    }
    expect(stageConstraint.match(/'[^']+'/g)).toHaveLength(6)
    expect(eventConstraint.match(/'[^']+'/g)).toHaveLength(6)
    expect(migration0053).not.toMatch(/'saved'|'resume_prepared'/i)
  })

  it('enforces immutable provenance, bounded manual fields, and safe URLs', () => {
    expect(migration0053).toMatch(/constraint applications_origin_check/i)
    expect(migration0053).toMatch(/constraint applications_manual_fields_check/i)
    expect(migration0053).toMatch(/char_length\(company\)\s*<=\s*200/i)
    expect(migration0053).toMatch(/char_length\(title\)\s*<=\s*300/i)
    expect(migration0053).toMatch(/char_length\(apply_url\)\s*<=\s*2048/i)
    expect(migration0053).toMatch(/char_length\(coalesce\(location, ''\)\)\s*<=\s*500/i)
    expect(migration0053).toMatch(/char_length\(notes\)\s*<=\s*20000/i)
    expect(migration0053).toMatch(
      /char_length\(coalesce\(description_text, ''\)\)\s*<=\s*100000/i,
    )
    const urlGuard = functionBody('tracker_https_url_valid')
    expect(urlGuard).toMatch(/\^https:\/\//i)
    expect(urlGuard).toMatch(/@\]\+/i)
    expect(migration0053).toMatch(/applications_job_url_check[\s\S]*tracker_https_url_valid/i)
    expect(migration0053).toMatch(
      /create unique index applications_system_source_unique_idx[\s\S]*where origin = 'system'/i,
    )
    expect(migration0053).not.toMatch(/grant update[^;]*origin|grant update[^;]*snapshot/i)
  })

  it('couples application, event, and resume ownership without deleting applications', () => {
    expect(migration0053).toMatch(/unique \(id, user_id\)/i)
    expect(migration0053).toMatch(/unique \(id, user_id\)[\s\S]*public\.resumes/i)
    expect(migration0053).toMatch(
      /constraint applications_resume_owner_fkey[\s\S]*foreign key \(resume_id, user_id\)[\s\S]*references public\.resumes \(id, user_id\)[\s\S]*on delete set null \(resume_id\)/i,
    )
    expect(migration0053).toMatch(
      /constraint application_stage_events_application_owner_fkey[\s\S]*foreign key \(application_id, user_id\)[\s\S]*references public\.applications \(id, user_id\)/i,
    )
    expect(migration0053).toMatch(/create index applications_resume_owner_idx/i)
    expect(migration0053).not.toMatch(/delete_application\s*\(/i)
  })

  it('derives the current projection from stable event order and protects the final event', () => {
    const body = functionBody('sync_application_stage_projection')
    expect(body).toMatch(/security definer/i)
    expect(body).toMatch(/set search_path = ''/i)
    expect(body).toMatch(/occurred_on desc[\s\S]*created_at desc[\s\S]*id desc/i)
    expect(body).toMatch(/every application needs one timeline event|final_application_event/i)
    expect(body).toMatch(/current_stage[\s\S]*current_stage_date[\s\S]*updated_at/i)
    expect(migration0053).toMatch(
      /create trigger application_stage_events_sync_projection[\s\S]*after insert or update or delete/i,
    )
    expect(migration0053).not.toMatch(/unique[^;\n]*application_id[^;\n]*stage/i)
  })

  it('defines the exact narrow authenticated RPC inventory and ACLs', () => {
    const signatures = [
      'mark_job_applied\\(uuid\\)',
      'create_manual_application\\(text, text, text, text, text, date\\)',
      'set_application_pin\\(uuid, boolean\\)',
      'update_application_text_field\\(uuid, text, text\\)',
      'set_application_resume\\(uuid, uuid\\)',
      'append_application_stage\\(uuid, text, date\\)',
      'update_application_stage_event\\(uuid, text, date\\)',
      'delete_application_stage_event\\(uuid\\)',
      'dashboard_applied_applications\\(\\)',
    ]
    for (const signature of signatures) {
      expect(migration0053).toMatch(
        new RegExp(`revoke execute on function public\\.${signature}\\s+from public, anon`, 'i'),
      )
      expect(migration0053).toMatch(
        new RegExp(`grant execute on function public\\.${signature}\\s+to authenticated`, 'i'),
      )
    }
    for (const name of [
      'mark_job_applied',
      'create_manual_application',
      'set_application_pin',
      'update_application_text_field',
      'set_application_resume',
      'append_application_stage',
      'update_application_stage_event',
      'delete_application_stage_event',
    ]) {
      const body = functionBody(name)
      expect(body).toMatch(/security definer/i)
      expect(body).toMatch(/set search_path = ''/i)
      expect(body).toMatch(/auth\.uid\(\)/i)
      expect(body).toMatch(/user_id|owner_id/i)
    }
  })

  it('pins the six-parameter manual-create contract and its one named record', () => {
    expect(migration0053).toMatch(
      /create function public\.create_manual_application\(\s*p_company text,\s*p_title text,\s*p_apply_url text,\s*p_notes text,\s*p_stage text,\s*p_occurred_on date\s*\)\s*returns table \(\s*application_id uuid,\s*duplicate_warning boolean\s*\)/i,
    )
    const body = functionBody('create_manual_application')
    expect(body).toMatch(/insert into public\.applications/i)
    expect(body).toMatch(/insert into public\.application_stage_events/i)
    expect(body).toMatch(/lower\(btrim\(/i)
    expect(body).toMatch(/return query/i)
  })

  it('marks applied atomically, snapshots server data, and backfills legacy history', () => {
    const body = functionBody('mark_job_applied')
    expect(body).toMatch(/for update/i)
    expect(body).toMatch(/insert into public\.applications/i)
    expect(body).toMatch(/on conflict \(user_id, source_job_id\)/i)
    expect(body).toMatch(/insert into public\.application_stage_events/i)
    expect(body).toMatch(/current_date/i)
    expect(body).toMatch(/applied_at\s*=\s*coalesce\(/i)
    expect(body).toMatch(/dismissed_at\s*=\s*null/i)
    expect(body).toMatch(/description_html|snapshot_description_html/i)
    expect(body).toMatch(/description_text|snapshot_description_text/i)
    expect(migration0053).toMatch(
      /insert into public\.applications[\s\S]*where user_job\.applied_at is not null/i,
    )
    expect(migration0053).toMatch(
      /insert into public\.application_stage_events[\s\S]*where user_job\.applied_at is not null/i,
    )
  })

  it('keeps tracker members out of Active and projects durable applied history', () => {
    const feedBody = functionBody('dashboard_feed_page')
    expect(feedBody).toMatch(
      /p_lifecycle\s*<>\s*'active'|p_lifecycle\s*=\s*'active'[\s\S]*not exists/i,
    )
    expect(feedBody).toMatch(/public\.applications/i)

    expect(migration0053).toMatch(
      /create function public\.dashboard_applied_applications\(\)[\s\S]*returns table \(\s*application_id uuid,\s*company text,\s*title text,\s*location text,\s*apply_url text,\s*applied_on date,\s*current_stage text,\s*current_stage_date date\s*\)/i,
    )
    const appliedBody = functionBody('dashboard_applied_applications')
    expect(appliedBody).toMatch(/application\.origin\s*=\s*'system'/i)
    expect(appliedBody).not.toMatch(/join public\.jobs|job\.status\s*=\s*'open'/i)
    expect(appliedBody).toMatch(
      /stage\s*=\s*'applied'[\s\S]*occurred_on asc[\s\S]*created_at asc[\s\S]*id asc[\s\S]*limit 1/i,
    )
    expect(appliedBody).toMatch(/tracker_https_url_valid\(application\.apply_url\)/i)
  })
})

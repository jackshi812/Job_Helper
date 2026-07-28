import { describe, expect, it } from 'vitest'

import migration0060 from '../../supabase/migrations/0060_ranking_item_owner_delete_index.sql?raw'

describe('migration 0060 — ranking item owner delete index', () => {
  it('is transactional and indexes the owner FK used by delete-all', () => {
    expect(migration0060).toMatch(/^\s*begin\s*;/i)
    expect(migration0060).toMatch(/\bcommit\s*;\s*$/i)
    expect(migration0060).toMatch(
      /create index if not exists deterministic_ranking_items_user_id_idx\s+on public\.deterministic_ranking_items \(user_id\)/i,
    )
  })
})

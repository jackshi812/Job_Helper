begin;

-- AUTH-04 cleanup filters ranking items by owner, and auth.users deletion
-- validates the same FK column. Without this index, both operations scan the
-- complete ranking queue and exceed the hosted statement timeout.
create index if not exists deterministic_ranking_items_user_id_idx
  on public.deterministic_ranking_items (user_id);

commit;

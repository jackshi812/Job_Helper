begin;

-- PostgreSQL does not automatically index referencing foreign-key columns.
-- These indexes keep exact user/job cleanup and normal cascade paths bounded.
create index deterministic_ranking_items_user_job_id_idx
  on public.deterministic_ranking_items (user_job_id);
create index deterministic_ranking_items_job_id_idx
  on public.deterministic_ranking_items (job_id);

-- Migration 0037 selected whole table rows into CTE columns. PostgreSQL requires
-- parentheses when dereferencing those composite columns outside their source
-- relation, for example `(page.user_job).id`.
create or replace function public.dashboard_feed_page(
  p_lifecycle text,
  p_order text,
  p_tiers text[],
  p_hidden_company_keys text[],
  p_query_signature text,
  p_cursor jsonb default null,
  p_limit integer default 200
)
returns table (
  row_data jsonb,
  cursor_data jsonb,
  has_more boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  cursor_id uuid;
  cursor_posted_at timestamptz;
  cursor_first_seen_at timestamptz;
  cursor_score integer;
  cursor_lifecycle_at timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required';
  end if;
  if p_lifecycle not in ('active', 'applied', 'dismissed') then
    raise exception 'invalid_dashboard_lifecycle';
  end if;
  if p_order not in ('newest', 'score_desc', 'score_asc')
    or (p_lifecycle <> 'active' and p_order <> 'newest')
  then
    raise exception 'invalid_dashboard_order';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'invalid_dashboard_limit';
  end if;
  if p_query_signature is null
    or char_length(p_query_signature) not between 1 and 512
    or p_query_signature ~ '[[:cntrl:]]'
  then
    raise exception 'invalid_dashboard_query_signature';
  end if;
  if p_tiers is null
    or cardinality(p_tiers) not between 1 and 3
    or array_position(p_tiers, null) is not null
    or exists (
      select 1 from unnest(p_tiers) as tier
      where tier not in ('Strong', 'Good', 'Weak')
    )
    or cardinality(p_tiers) <> (
      select count(distinct tier) from unnest(p_tiers) as tier
    )
  then
    raise exception 'invalid_dashboard_tiers';
  end if;
  if p_hidden_company_keys is null
    or cardinality(p_hidden_company_keys) > 200
    or array_position(p_hidden_company_keys, null) is not null
    or exists (
      select 1 from unnest(p_hidden_company_keys) as company_key
      where company_key <> lower(btrim(company_key))
        or char_length(company_key) not between 1 and 200
        or company_key ~ '[[:cntrl:]]'
    )
  then
    raise exception 'invalid_dashboard_company_keys';
  end if;

  if p_cursor is not null then
    if jsonb_typeof(p_cursor) <> 'object'
      or (
        select array_agg(key order by key)
        from jsonb_object_keys(p_cursor) as key
      ) <> array[
        'first_seen_at', 'id', 'lifecycle', 'lifecycle_at', 'order',
        'posted_at', 'score', 'signature', 'v'
      ]::text[]
      or jsonb_typeof(p_cursor -> 'v') <> 'number'
      or (p_cursor ->> 'v')::integer <> 1
      or jsonb_typeof(p_cursor -> 'id') <> 'string'
      or (p_cursor ->> 'id') !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(p_cursor -> 'lifecycle') <> 'string'
      or jsonb_typeof(p_cursor -> 'order') <> 'string'
      or jsonb_typeof(p_cursor -> 'signature') <> 'string'
      or jsonb_typeof(p_cursor -> 'posted_at') not in ('string', 'null')
      or jsonb_typeof(p_cursor -> 'first_seen_at') not in ('string', 'null')
      or jsonb_typeof(p_cursor -> 'score') not in ('number', 'null')
      or jsonb_typeof(p_cursor -> 'lifecycle_at') not in ('string', 'null')
      or (
        jsonb_typeof(p_cursor -> 'score') = 'number'
        and (
          (p_cursor ->> 'score')::numeric <> trunc((p_cursor ->> 'score')::numeric)
          or (p_cursor ->> 'score')::integer not between 0 and 100
        )
      )
    then
      raise exception 'invalid_dashboard_cursor';
    end if;
    if p_cursor ->> 'lifecycle' <> p_lifecycle
      or p_cursor ->> 'order' <> p_order
      or p_cursor ->> 'signature' <> p_query_signature
    then
      raise exception 'dashboard_cursor_signature_mismatch';
    end if;

    cursor_id := (p_cursor ->> 'id')::uuid;
    cursor_posted_at := (p_cursor ->> 'posted_at')::timestamptz;
    cursor_first_seen_at := (p_cursor ->> 'first_seen_at')::timestamptz;
    cursor_score := (p_cursor ->> 'score')::integer;
    cursor_lifecycle_at := (p_cursor ->> 'lifecycle_at')::timestamptz;

    if (p_lifecycle = 'active' and (
        cursor_posted_at is null
        or cursor_first_seen_at is null
        or (p_order <> 'newest' and cursor_score is null)
      ))
      or (p_lifecycle <> 'active' and cursor_lifecycle_at is null)
    then
      raise exception 'invalid_dashboard_cursor';
    end if;
  end if;

  return query
  with candidates as (
    select
      user_job,
      job,
      company,
      coalesce(
        nullif(btrim(company.name), ''),
        nullif(btrim(job.source_company_name), '')
      ) as company_label,
      lower(regexp_replace(coalesce(
        nullif(btrim(company.name), ''),
        nullif(btrim(job.source_company_name), '')
      ), '[[:space:]]+', ' ', 'g')) as company_key
    from public.user_jobs as user_job
    join public.jobs as job on job.id = user_job.job_id
    left join public.companies as company on company.id = job.company_id
    join public.deterministic_ranking_state as ranking_state
      on ranking_state.user_id = user_job.user_id
      and ranking_state.active_revision = user_job.deterministic_revision
    where user_job.user_id = (select auth.uid())
      and job.status = 'open'
      and user_job.deterministic_eligible is true
      and user_job.deterministic_revision is not null
      and user_job.deterministic_score is not null
      and user_job.deterministic_tier is not null
      and user_job.deterministic_tier = any(p_tiers)
      and (
        p_lifecycle = 'active'
        and user_job.applied_at is null
        and user_job.dismissed_at is null
        or p_lifecycle = 'applied'
        and user_job.applied_at is not null
        and user_job.dismissed_at is null
        or p_lifecycle = 'dismissed'
        and user_job.dismissed_at is not null
        and user_job.applied_at is null
      )
      and coalesce(
        nullif(btrim(company.name), ''),
        nullif(btrim(job.source_company_name), '')
      ) is not null
      and not (
        lower(regexp_replace(coalesce(
          nullif(btrim(company.name), ''),
          nullif(btrim(job.source_company_name), '')
        ), '[[:space:]]+', ' ', 'g')) = any(p_hidden_company_keys)
      )
      and (
        p_cursor is null
        or (
          p_lifecycle = 'applied'
          and (
            user_job.applied_at < cursor_lifecycle_at
            or (
              user_job.applied_at = cursor_lifecycle_at
              and user_job.id < cursor_id
            )
          )
        )
        or (
          p_lifecycle = 'dismissed'
          and (
            user_job.dismissed_at < cursor_lifecycle_at
            or (
              user_job.dismissed_at = cursor_lifecycle_at
              and user_job.id < cursor_id
            )
          )
        )
        or (
          p_lifecycle = 'active'
          and p_order = 'newest'
          and (
            coalesce(job.posted_at, '-infinity'::timestamptz) < cursor_posted_at
            or (
              coalesce(job.posted_at, '-infinity'::timestamptz) = cursor_posted_at
              and job.first_seen_at < cursor_first_seen_at
            )
            or (
              coalesce(job.posted_at, '-infinity'::timestamptz) = cursor_posted_at
              and job.first_seen_at = cursor_first_seen_at
              and user_job.id < cursor_id
            )
          )
        )
        or (
          p_lifecycle = 'active'
          and p_order = 'score_desc'
          and (
            user_job.deterministic_score < cursor_score
            or (
              user_job.deterministic_score = cursor_score
              and coalesce(job.posted_at, '-infinity'::timestamptz)
                < cursor_posted_at
            )
            or (
              user_job.deterministic_score = cursor_score
              and coalesce(job.posted_at, '-infinity'::timestamptz)
                = cursor_posted_at
              and job.first_seen_at < cursor_first_seen_at
            )
            or (
              user_job.deterministic_score = cursor_score
              and coalesce(job.posted_at, '-infinity'::timestamptz)
                = cursor_posted_at
              and job.first_seen_at = cursor_first_seen_at
              and user_job.id < cursor_id
            )
          )
        )
        or (
          p_lifecycle = 'active'
          and p_order = 'score_asc'
          and (
            user_job.deterministic_score > cursor_score
            or (
              user_job.deterministic_score = cursor_score
              and coalesce(job.posted_at, '-infinity'::timestamptz)
                < cursor_posted_at
            )
            or (
              user_job.deterministic_score = cursor_score
              and coalesce(job.posted_at, '-infinity'::timestamptz)
                = cursor_posted_at
              and job.first_seen_at < cursor_first_seen_at
            )
            or (
              user_job.deterministic_score = cursor_score
              and coalesce(job.posted_at, '-infinity'::timestamptz)
                = cursor_posted_at
              and job.first_seen_at = cursor_first_seen_at
              and user_job.id < cursor_id
            )
          )
        )
      )
  ),
  page_window as (
    select
      candidate.*,
      row_number() over (
        order by
          case when p_lifecycle = 'applied'
            then (candidate.user_job).applied_at end desc nulls last,
          case when p_lifecycle = 'dismissed'
            then (candidate.user_job).dismissed_at end desc nulls last,
          case when p_lifecycle = 'active' and p_order = 'score_desc'
            then (candidate.user_job).deterministic_score end desc nulls last,
          case when p_lifecycle = 'active' and p_order = 'score_asc'
            then (candidate.user_job).deterministic_score end asc nulls last,
          case when p_lifecycle = 'active'
            then (candidate.job).posted_at end desc nulls last,
          case when p_lifecycle = 'active'
            then (candidate.job).first_seen_at end desc,
          (candidate.user_job).id desc
      ) as page_position
    from candidates as candidate
    order by
      case when p_lifecycle = 'applied'
        then (candidate.user_job).applied_at end desc nulls last,
      case when p_lifecycle = 'dismissed'
        then (candidate.user_job).dismissed_at end desc nulls last,
      case when p_lifecycle = 'active' and p_order = 'score_desc'
        then (candidate.user_job).deterministic_score end desc nulls last,
      case when p_lifecycle = 'active' and p_order = 'score_asc'
        then (candidate.user_job).deterministic_score end asc nulls last,
      case when p_lifecycle = 'active'
        then (candidate.job).posted_at end desc nulls last,
      case when p_lifecycle = 'active'
        then (candidate.job).first_seen_at end desc,
      (candidate.user_job).id desc
    limit p_limit + 1
  ),
  continuation as (
    select exists (
      select 1 from page_window where page_position = p_limit + 1
    ) as has_more
  )
  select
    jsonb_build_object(
      'id', (page.user_job).id,
      'deterministic_revision', (page.user_job).deterministic_revision,
      'deterministic_eligible', (page.user_job).deterministic_eligible,
      'deterministic_score', (page.user_job).deterministic_score,
      'deterministic_tier', (page.user_job).deterministic_tier,
      'deterministic_breakdown', (page.user_job).deterministic_breakdown,
      'deterministic_filter_code', (page.user_job).deterministic_filter_code,
      'deterministic_filter_detail', (page.user_job).deterministic_filter_detail,
      'deterministic_ranked_at', (page.user_job).deterministic_ranked_at,
      'deterministic_best_fit_resume_id',
        (page.user_job).deterministic_best_fit_resume_id,
      'deterministic_runner_up_resume_id',
        (page.user_job).deterministic_runner_up_resume_id,
      'seen_at', (page.user_job).seen_at,
      'dismissed_at', (page.user_job).dismissed_at,
      'applied_at', (page.user_job).applied_at,
      'jobs', jsonb_build_object(
        'id', (page.job).id,
        'title', (page.job).title,
        'location', (page.job).location,
        'absolute_url', (page.job).absolute_url,
        'posted_at', (page.job).posted_at,
        'first_seen_at', (page.job).first_seen_at,
        'status', (page.job).status,
        'source_company_name', (page.job).source_company_name,
        'companies', case when (page.company).id is null then null else
          jsonb_build_object('name', (page.company).name)
        end
      )
    ),
    jsonb_build_object(
      'v', 1,
      'lifecycle', p_lifecycle,
      'order', p_order,
      'signature', p_query_signature,
      'id', (page.user_job).id,
      'posted_at', case when p_lifecycle = 'active'
        then coalesce((page.job).posted_at, '-infinity'::timestamptz)
        else null end,
      'first_seen_at', case when p_lifecycle = 'active'
        then (page.job).first_seen_at else null end,
      'score', case when p_lifecycle = 'active'
        then (page.user_job).deterministic_score else null end,
      'lifecycle_at', case
        when p_lifecycle = 'applied' then (page.user_job).applied_at
        when p_lifecycle = 'dismissed' then (page.user_job).dismissed_at
        else null end
    ),
    continuation.has_more
  from page_window as page
  cross join continuation
  where page.page_position <= p_limit
  order by page.page_position;

  -- Lifecycle-specific order contracts:
  -- p_lifecycle = 'applied': user_job.applied_at DESC, user_job.id DESC
  -- p_lifecycle = 'dismissed': user_job.dismissed_at DESC, user_job.id DESC
  -- p_order = 'score_desc': user_job.deterministic_score DESC, user_job.id DESC
  -- p_order = 'score_asc': user_job.deterministic_score ASC, user_job.id DESC
  -- p_order = 'newest': job.posted_at DESC NULLS LAST,
  --   job.first_seen_at DESC, user_job.id DESC
end;
$$;

revoke execute on function public.dashboard_feed_page(
  text, text, text[], text[], text, jsonb, integer
) from public, anon;
grant execute on function public.dashboard_feed_page(
  text, text, text[], text[], text, jsonb, integer
) to authenticated;

comment on function public.dashboard_feed_page(
  text, text, text[], text[], text, jsonb, integer
) is
  'Authenticated RLS-scoped keyset page; valid composite dereferences, filters before a bounded 200-row limit, and one-row continuation evidence.';

commit;

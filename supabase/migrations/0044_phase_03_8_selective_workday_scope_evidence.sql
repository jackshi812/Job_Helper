begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.jobs
  drop constraint jobs_scope_evidence_check,
  add constraint jobs_scope_evidence_check check (
    (
      source not in (
        'workday', 'eightfold', 'oracle_recruiting', 'goldman_higher'
      )
      and scope_evidence is null
    )
    or (
      source = 'workday'
      and scope_evidence is null
    )
    or (
      source = 'workday'
      and jsonb_typeof(scope_evidence) = 'object'
      and scope_evidence ?& array[
        'sourceKey', 'detailCountryCode', 'selectionMode', 'recentDays',
        'titleKeywords', 'providerFacetLabels'
      ]
      and scope_evidence - array[
        'sourceKey', 'detailCountryCode', 'selectionMode', 'recentDays',
        'titleKeywords', 'providerFacetLabels'
      ] = '{}'::jsonb
      and scope_evidence ->> 'sourceKey' in (
        'workday:wd5:ms:External',
        'workday:wd1:ghr:Lateral-US',
        'workday:wd1:blackrock:BlackRock_Professional',
        'workday:wd3:barclays:External_Career_Site_Barclays'
      )
      and scope_evidence ->> 'detailCountryCode' = 'US'
      and scope_evidence ->> 'selectionMode' = 'recent_exact_us'
      and scope_evidence -> 'recentDays' = '7'::jsonb
      and (
        (
          scope_evidence ->> 'sourceKey' = 'workday:wd1:ghr:Lateral-US'
          and scope_evidence -> 'titleKeywords' =
            '["finance", "analytics", "data", "research"]'::jsonb
          and scope_evidence -> 'providerFacetLabels' = '[]'::jsonb
        )
        or (
          scope_evidence ->> 'sourceKey' =
            'workday:wd3:barclays:External_Career_Site_Barclays'
          and scope_evidence -> 'titleKeywords' = '[]'::jsonb
          and scope_evidence -> 'providerFacetLabels' =
            '["Data & Analytics", "Finance", "Investment Banking", "Research", "Risk", "Technology"]'::jsonb
        )
        or (
          scope_evidence ->> 'sourceKey' in (
            'workday:wd5:ms:External',
            'workday:wd1:blackrock:BlackRock_Professional'
          )
          and scope_evidence -> 'titleKeywords' = '[]'::jsonb
          and scope_evidence -> 'providerFacetLabels' = '[]'::jsonb
        )
      )
    )
    or (
      source in ('eightfold', 'oracle_recruiting', 'goldman_higher')
      and jsonb_typeof(scope_evidence) = 'object'
      and scope_evidence ?& array[
        'sourceKey', 'providerCategoryLabel', 'matchedTerm',
        'detailCountryCode', 'externalIdDigest'
      ]
      and scope_evidence - array[
        'sourceKey', 'providerCategoryLabel', 'matchedTerm',
        'detailCountryCode', 'externalIdDigest'
      ] = '{}'::jsonb
      and scope_evidence ->> 'sourceKey' in (
        'eightfold:morganstanley',
        'oracle:jpmc:CX_1001',
        'goldman_higher:roles'
      )
      and scope_evidence ->> 'sourceKey' = case source
        when 'eightfold' then 'eightfold:morganstanley'
        when 'oracle_recruiting' then 'oracle:jpmc:CX_1001'
        when 'goldman_higher' then 'goldman_higher:roles'
      end
      and length(scope_evidence ->> 'providerCategoryLabel') between 1 and 160
      and scope_evidence ->> 'matchedTerm' in (
        'Data', 'Technology', 'Finance', 'Investment',
        'Research', 'Risk', 'Capital Markets'
      )
      and scope_evidence ->> 'detailCountryCode' = 'US'
      and scope_evidence ->> 'externalIdDigest' ~ '^[0-9a-f]{64}$'
      and scope_evidence ->> 'externalIdDigest' = pg_catalog.encode(
        extensions.digest(
          convert_to(
            concat(
              '[',
              to_json(scope_evidence ->> 'sourceKey')::text, ',',
              to_json(external_id)::text, ',',
              to_json(scope_evidence ->> 'providerCategoryLabel')::text, ',',
              to_json(scope_evidence ->> 'matchedTerm')::text, ',',
              to_json('US'::text)::text,
              ']'
            ),
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      )
    )
  );

comment on constraint jobs_scope_evidence_check on public.jobs is
  'Allows null evidence for established sources, exact Phase 03.8 selective Workday scope proof for four frozen identities, and the existing branded proof contract.';

commit;

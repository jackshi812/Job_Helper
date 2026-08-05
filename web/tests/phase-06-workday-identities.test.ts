import { describe, expect, it, vi } from 'vitest'
import {
  resolveWorkdayIdentity,
  WORKDAY_IDENTITIES,
  type WorkdayIdentity,
} from '../../supabase/functions/_shared/workday-identities.ts'
import {
  pollConnector,
  type SupportedDetection,
  verifyConnector,
} from '../../supabase/functions/_shared/connectors.ts'

const waveOneTargets = [
  {
    companyName: 'BMO',
    tenant: 'bmo',
    region: 'wd3',
    site: 'External',
    sourceKey: 'workday:wd3:bmo:External',
    publicBoard: 'https://bmo.wd3.myworkdayjobs.com/External',
  },
  {
    companyName: 'PIMCO',
    tenant: 'pimco',
    region: 'wd1',
    site: 'pimco-careers',
    sourceKey: 'workday:wd1:pimco:pimco-careers',
    publicBoard: 'https://pimco.wd1.myworkdayjobs.com/pimco-careers',
  },
  {
    companyName: 'Visa',
    tenant: 'visa',
    region: 'wd5',
    site: 'Visa',
    sourceKey: 'workday:wd5:visa:Visa',
    publicBoard: 'https://visa.wd5.myworkdayjobs.com/Visa',
  },
  {
    companyName: 'Apollo Global Management',
    tenant: 'athene',
    region: 'wd5',
    site: 'Apollo_Careers',
    sourceKey: 'workday:wd5:athene:Apollo_Careers',
    publicBoard: 'https://athene.wd5.myworkdayjobs.com/Apollo_Careers',
  },
  {
    companyName: 'Invesco',
    tenant: 'invesco',
    region: 'wd1',
    site: 'IVZ',
    sourceKey: 'workday:wd1:invesco:IVZ',
    publicBoard: 'https://invesco.wd1.myworkdayjobs.com/IVZ',
  },
  {
    companyName: 'Mastercard',
    tenant: 'mastercard',
    region: 'wd1',
    site: 'CorporateCareers',
    sourceKey: 'workday:wd1:mastercard:CorporateCareers',
    publicBoard: 'https://mastercard.wd1.myworkdayjobs.com/CorporateCareers',
  },
  {
    companyName: 'Northern Trust',
    tenant: 'ntrs',
    region: 'wd1',
    site: 'northerntrust',
    sourceKey: 'workday:wd1:ntrs:northerntrust',
    publicBoard: 'https://ntrs.wd1.myworkdayjobs.com/northerntrust',
  },
  {
    companyName: 'Vanguard',
    tenant: 'vanguard',
    region: 'wd5',
    site: 'vanguard_external',
    sourceKey: 'workday:wd5:vanguard:vanguard_external',
    publicBoard: 'https://vanguard.wd5.myworkdayjobs.com/vanguard_external',
  },
  {
    companyName: 'Workday',
    tenant: 'workday',
    region: 'wd5',
    site: 'Workday',
    sourceKey: 'workday:wd5:workday:Workday',
    publicBoard: 'https://workday.wd5.myworkdayjobs.com/Workday',
  },
  {
    companyName: 'NVIDIA',
    tenant: 'nvidia',
    region: 'wd5',
    site: 'NVIDIAExternalCareerSite',
    sourceKey: 'workday:wd5:nvidia:NVIDIAExternalCareerSite',
    publicBoard: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite',
  },
] as const

const newRegistryTargets = waveOneTargets.filter(({ sourceKey }) => ![
  'workday:wd5:visa:Visa',
  'workday:wd1:pimco:pimco-careers',
  'workday:wd1:invesco:IVZ',
].includes(sourceKey))

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Phase 06 Wave 1 Workday identity authority', () => {
  it('resolves all ten sealed tuples while preserving the fourteen prior records', () => {
    expect(Object.keys(WORKDAY_IDENTITIES)).toHaveLength(21)
    expect(Object.isFrozen(WORKDAY_IDENTITIES)).toBe(true)

    for (const target of waveOneTargets) {
      const identity = resolveWorkdayIdentity(
        target.tenant,
        target.region,
        target.site,
        'jobs',
      )
      expect(identity).toMatchObject({
        companyName: target.companyName,
        tenant: target.tenant,
        region: target.region,
        site: target.site,
        hostForm: 'jobs',
        sourceKey: target.sourceKey,
        publicBoard: target.publicBoard,
        applyCapitalOneEligibility: false,
        selectiveRecentUsScope: {
          recentDays: 7,
          maxPages: 100,
          maxListings: 2_000,
          maxDetails: 199,
        },
      })
      expect(identity?.origin).toBe(
        `https://${target.tenant}.${target.region}.myworkdayjobs.com`,
      )
      expect(identity?.cxsRoot).toBe(
        `${identity?.origin}/wday/cxs/${target.tenant}/${target.site}`,
      )
      expect(Object.isFrozen(identity)).toBe(true)
      expect(Object.isFrozen(identity?.selectiveRecentUsScope)).toBe(true)
    }
  })

  it('rejects every one-field and casing mutation before verification fetch', async () => {
    for (const target of waveOneTargets) {
      const mutations = [
        [`${target.tenant}-lookalike`, target.region, target.site, 'jobs'],
        [target.tenant, `${target.region}0`, target.site, 'jobs'],
        [target.tenant, target.region, `${target.site}-lookalike`, 'jobs'],
        [target.tenant, target.region, target.site, 'site'],
        [target.tenant.toUpperCase(), target.region, target.site, 'jobs'],
      ] as const

      for (const tuple of mutations) {
        expect(resolveWorkdayIdentity(...tuple)).toBeNull()
        const providerFetch = vi.fn()
        await expect(verifyConnector({
          ats: 'workday',
          slug: tuple[0],
          region: tuple[1],
          site: tuple[2],
          hostForm: tuple[3],
        } as SupportedDetection, providerFetch)).rejects.toThrow('invalid_identity')
        expect(providerFetch).not.toHaveBeenCalled()
      }
    }
  })

  it('rejects persisted-token and cross-company source mutations before polling fetch', async () => {
    for (const [index, target] of waveOneTargets.entries()) {
      const sibling = waveOneTargets[(index + 1) % waveOneTargets.length]
      const mutations = [
        { board_token: `${target.tenant}-lookalike` },
        { region: `${target.region}0` },
        { site_token: `${target.site}-lookalike` },
        { source_key: sibling.sourceKey },
        { source_key: target.sourceKey.toUpperCase() },
      ]

      for (const mutation of mutations) {
        const providerFetch = vi.fn()
        vi.stubGlobal('fetch', providerFetch)
        await expect(pollConnector({
          ats_type: 'workday',
          board_token: target.tenant,
          region: target.region,
          site_token: target.site,
          source_key: target.sourceKey,
          activation_state: 'active',
          ...mutation,
        }, new Set())).rejects.toThrow(
          'inactive_connector:workday_identity_not_allowed',
        )
        expect(providerFetch).not.toHaveBeenCalled()
        vi.unstubAllGlobals()
      }
    }
  })

  it('builds every new provider request only from its frozen registry record', async () => {
    for (const target of newRegistryTargets) {
      const identity = resolveWorkdayIdentity(
        target.tenant,
        target.region,
        target.site,
        'jobs',
      ) as WorkdayIdentity
      const providerFetch = vi.fn((input: string | URL | Request) => {
        expect(String(input)).toBe(`${identity.cxsRoot}/jobs`)
        return Promise.resolve(jsonResponse({
          total: 1,
          jobPostings: [{
            title: `${target.companyName} current role`,
            externalPath: '/job/US/Current-role_REQ-1',
            locationsText: 'United States',
            postedOn: 'Posted Today',
          }],
        }))
      })

      await expect(verifyConnector({
        ats: 'workday',
        slug: target.tenant,
        region: target.region,
        site: target.site,
        hostForm: 'jobs',
      }, providerFetch)).resolves.toMatchObject({
        companyName: target.companyName,
        sourceKey: target.sourceKey,
        careersUrl: target.publicBoard,
        jobCount: 1,
      })
      expect(providerFetch).toHaveBeenCalledTimes(1)
    }
  })
})

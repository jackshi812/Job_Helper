import {
  companyName,
  preferenceVisible,
  tierPresentation,
  type FeedRow,
  type Tier,
} from './feed'

export const ALL_SCORE_TIERS: readonly Tier[] = ['Strong', 'Good', 'Weak']

export interface CompanyOption {
  key: string
  label: string
}

export interface DashboardFilterState {
  showDismissed: boolean
  appliedHiddenKeys: ReadonlySet<string>
  selectedTiers: ReadonlySet<Tier>
}

export function normalizedCompanyKey(name: string): string {
  return name.normalize('NFKC').trim().toLowerCase()
}

export function dashboardCompanyOptions(rows: readonly FeedRow[]): CompanyOption[] {
  const labels = new Map<string, string>()
  for (const row of rows) {
    const label = companyName(row)
    if (!label) continue
    const key = normalizedCompanyKey(label)
    if (key && !labels.has(key)) labels.set(key, label.trim())
  }

  return [...labels.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }))
}

export function searchCompanyOptions(
  options: readonly CompanyOption[],
  query: string,
): CompanyOption[] {
  const needle = query.normalize('NFKC').trim().toLowerCase()
  if (!needle) return [...options]
  return options.filter((option) => option.key.includes(needle))
}

export function copyHiddenCompanyKeys(keys: ReadonlySet<string>): Set<string> {
  return new Set(keys)
}

export function resetHiddenCompanyKeys(): Set<string> {
  return new Set()
}

export function toggleHiddenCompanyKey(
  hiddenKeys: ReadonlySet<string>,
  key: string,
): Set<string> {
  const next = new Set(hiddenKeys)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

export function toggleScoreTier(selected: ReadonlySet<Tier>, tier: Tier): Set<Tier> {
  const next = new Set(selected)
  if (next.has(tier)) next.delete(tier)
  else next.add(tier)
  return next
}

export function baseDashboardVisible(
  row: FeedRow,
  showDismissed: boolean,
): boolean {
  if (showDismissed) return row.dismissed_at !== null
  if (row.dismissed_at !== null) return false
  return preferenceVisible(row)
}

export function filterDashboardRows(
  rows: readonly FeedRow[],
  state: DashboardFilterState,
): FeedRow[] {
  return rows.filter((row) => {
    if (!baseDashboardVisible(row, state.showDismissed)) return false
    const name = companyName(row)
    if (!name || state.appliedHiddenKeys.has(normalizedCompanyKey(name))) return false
    return state.selectedTiers.has(tierPresentation(row.score).label)
  })
}

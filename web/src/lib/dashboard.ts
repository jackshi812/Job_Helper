import {
  companyName,
  relativePostedTime,
  type DashboardFeedOrder,
  type DashboardFeedPage,
  type DashboardFeedQuery,
  type FeedRow,
  type LifecycleView,
  type Tier,
} from './feed'

export const ALL_SCORE_TIERS: readonly Tier[] = ['Strong', 'Good', 'Weak']

export interface CompanyOption {
  key: string
  label: string
}

export interface DashboardFilterSelection {
  appliedHiddenKeys: ReadonlySet<string>
  selectedTiers: ReadonlySet<Tier>
}

export interface DashboardFeedQueryInput extends DashboardFilterSelection {
  lifecycle: LifecycleView
  activeOrder: DashboardFeedOrder
}

export interface DashboardLifecycleCopy {
  description: string
  resultNoun: string
  timeLabel: 'Posted' | 'Applied' | 'Dismissed'
  emptyHeading: string
  emptyBody: string
}

export interface DashboardFeedRowSnapshot {
  row: FeedRow
  index: number
}

export interface DashboardFeedRemoval {
  page: DashboardFeedPage
  snapshot: DashboardFeedRowSnapshot | null
}

export interface DashboardFeedAppendResult extends DashboardFeedPage {
  appendedCount: number
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

export function clearAllCompanies(options: readonly CompanyOption[]): Set<string> {
  return new Set(options.map((option) => option.key))
}

export function selectAllCompanies(): Set<string> {
  return new Set()
}

export function areAllCurrentCompaniesCleared(
  options: readonly CompanyOption[],
  hiddenKeys: ReadonlySet<string>,
): boolean {
  return options.every((option) => hiddenKeys.has(option.key))
}

export function areAllCurrentCompaniesSelected(
  options: readonly CompanyOption[],
  hiddenKeys: ReadonlySet<string>,
): boolean {
  return options.every((option) => !hiddenKeys.has(option.key))
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

export function scoreTierSummary(selected: ReadonlySet<Tier>): string {
  if (
    selected.size === ALL_SCORE_TIERS.length
    && ALL_SCORE_TIERS.every((tier) => selected.has(tier))
  ) return 'Score tiers: All'
  if (selected.size === 0) return 'Score tiers: None'
  return `Score tiers: ${selected.size} selected`
}

export function lifecycleViewFromToggles(
  showApplied: boolean,
  showDismissed: boolean,
): LifecycleView {
  if (showApplied === showDismissed) return 'active'
  return showApplied ? 'applied' : 'dismissed'
}

export function toggleDashboardLifecycle(
  current: LifecycleView,
  target: Exclude<LifecycleView, 'active'>,
): LifecycleView {
  return current === target ? 'active' : target
}

export function dashboardLifecycleCopy(view: LifecycleView): DashboardLifecycleCopy {
  if (view === 'applied') {
    return {
      description: "Jobs you've marked applied, newest applied first.",
      resultNoun: 'applied jobs',
      timeLabel: 'Applied',
      emptyHeading: 'No applied jobs yet',
      emptyBody: 'Jobs you mark applied will appear here.',
    }
  }
  if (view === 'dismissed') {
    return {
      description: "Jobs you've dismissed, newest dismissed first.",
      resultNoun: 'dismissed jobs',
      timeLabel: 'Dismissed',
      emptyHeading: 'No dismissed jobs',
      emptyBody: 'Jobs you dismiss will appear here.',
    }
  }
  return {
    description: 'New postings ranked against your preferences, newest first.',
    resultNoun: 'active jobs',
    timeLabel: 'Posted',
    emptyHeading: 'No matches yet',
    emptyBody: 'New matches will appear here after your jobs are ranked.',
  }
}

export function dashboardLifecycleTimestamp(
  row: FeedRow,
  view: LifecycleView,
): string | null {
  if (view === 'applied') return row.applied_at
  if (view === 'dismissed') return row.dismissed_at
  return relativePostedTime(row)
}

export function dashboardScoreSortAvailable(view: LifecycleView): boolean {
  return view === 'active'
}

export function buildDashboardFeedQuery(
  input: DashboardFeedQueryInput,
): DashboardFeedQuery {
  const tiers = ALL_SCORE_TIERS.filter((tier) => input.selectedTiers.has(tier))
  const hiddenCompanyKeys = [...input.appliedHiddenKeys]
    .map(normalizedCompanyKey)
    .filter(Boolean)
    .sort()

  return {
    lifecycle: input.lifecycle,
    order: input.lifecycle === 'active' ? input.activeOrder : 'newest',
    tiers,
    hiddenCompanyKeys,
  }
}

export function dashboardFeedQueryKey(query: DashboardFeedQuery) {
  return [
    'dashboard-feed',
    query.lifecycle,
    query.order,
    [...query.tiers],
    [...query.hiddenCompanyKeys],
  ] as const
}

export function resetDashboardFeedQuery(
  current: DashboardFeedQuery,
  lifecycle: LifecycleView,
  activeOrder: DashboardFeedOrder,
): { query: DashboardFeedQuery; cursor: null } {
  return {
    query: {
      lifecycle,
      order: lifecycle === 'active' ? activeOrder : 'newest',
      tiers: [...current.tiers],
      hiddenCompanyKeys: [...current.hiddenCompanyKeys],
    },
    cursor: null,
  }
}

export function appendDashboardFeedPage(
  current: DashboardFeedPage,
  incoming: DashboardFeedPage,
): DashboardFeedAppendResult {
  const seen = new Set(current.rows.map(({ id }) => id))
  const rows = [...current.rows]
  let appendedCount = 0
  for (const row of incoming.rows) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    rows.push(row)
    appendedCount += 1
  }
  return {
    rows,
    nextCursor: incoming.nextCursor,
    hasMore: incoming.hasMore,
    caughtUp: incoming.caughtUp,
    appendedCount,
  }
}

export function backfillDashboardFeedPage(
  current: DashboardFeedPage,
  incoming: DashboardFeedPage,
): DashboardFeedAppendResult {
  return appendDashboardFeedPage(current, incoming)
}

export function removeDashboardFeedRow(
  page: DashboardFeedPage,
  rowId: string,
): DashboardFeedRemoval {
  const index = page.rows.findIndex(({ id }) => id === rowId)
  if (index < 0) return { page, snapshot: null }
  return {
    page: {
      ...page,
      rows: page.rows.filter(({ id }) => id !== rowId),
    },
    snapshot: {
      row: page.rows[index],
      index,
    },
  }
}

export function restoreDashboardFeedRow(
  page: DashboardFeedPage,
  snapshot: DashboardFeedRowSnapshot | null,
): DashboardFeedPage {
  if (!snapshot || page.rows.some(({ id }) => id === snapshot.row.id)) return page
  const rows = [...page.rows]
  rows.splice(Math.min(Math.max(snapshot.index, 0), rows.length), 0, snapshot.row)
  return { ...page, rows }
}

export const DASHBOARD_COLUMN_STORAGE_KEY = 'job-copilot.dashboard.column-widths.v2'

export const DASHBOARD_COLUMNS = [
  { id: 'new', label: 'New', defaultWidth: 80, minWidth: 72, maxWidth: 112 },
  { id: 'job', label: 'Job', defaultWidth: 280, minWidth: 220, maxWidth: 520 },
  { id: 'company', label: 'Company', defaultWidth: 200, minWidth: 160, maxWidth: 400 },
  { id: 'location', label: 'Location', defaultWidth: 200, minWidth: 160, maxWidth: 420 },
  { id: 'score', label: 'Score', defaultWidth: 180, minWidth: 150, maxWidth: 260 },
  { id: 'posted', label: 'Posted', defaultWidth: 132, minWidth: 120, maxWidth: 220 },
  { id: 'apply', label: 'Apply', defaultWidth: 96, minWidth: 88, maxWidth: 140 },
  { id: 'action', label: 'Action', defaultWidth: 228, minWidth: 208, maxWidth: 280 },
] as const

export type DashboardColumnId = (typeof DASHBOARD_COLUMNS)[number]['id']
export type DashboardColumn = (typeof DASHBOARD_COLUMNS)[number]
export type DashboardColumnWidths = Record<DashboardColumnId, number>

export interface ColumnResizeCoordinator {
  activeColumnId: DashboardColumnId | null
}

export interface DashboardColumnStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const COLUMN_BY_ID = new Map(DASHBOARD_COLUMNS.map((column) => [column.id, column]))

export function defaultDashboardColumnWidths(): DashboardColumnWidths {
  return Object.fromEntries(
    DASHBOARD_COLUMNS.map((column) => [column.id, column.defaultWidth]),
  ) as DashboardColumnWidths
}

export function clampDashboardColumnWidth(columnId: DashboardColumnId, width: number): number {
  const column = COLUMN_BY_ID.get(columnId)
  if (!column || !Number.isFinite(width)) return column?.defaultWidth ?? 0
  return Math.min(column.maxWidth, Math.max(column.minWidth, width))
}

function parseStoredWidths(raw: string | null): DashboardColumnWidths {
  const defaults = defaultDashboardColumnWidths()
  if (raw === null) return defaults

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return defaults
    const payload = parsed as { version?: unknown; widths?: unknown }
    if (payload.version !== 2 || !payload.widths || typeof payload.widths !== 'object') {
      return defaults
    }

    const stored = payload.widths as Record<string, unknown>
    for (const column of DASHBOARD_COLUMNS) {
      const width = stored[column.id]
      if (
        typeof width === 'number' &&
        Number.isFinite(width) &&
        width >= column.minWidth &&
        width <= column.maxWidth
      ) {
        defaults[column.id] = width
      }
    }
    return defaults
  } catch {
    return defaults
  }
}

export function hydrateDashboardColumnWidths(
  storage: DashboardColumnStorage | null | undefined,
): DashboardColumnWidths {
  if (!storage) return defaultDashboardColumnWidths()
  try {
    return parseStoredWidths(storage.getItem(DASHBOARD_COLUMN_STORAGE_KEY))
  } catch {
    return defaultDashboardColumnWidths()
  }
}

export function loadDashboardColumnWidths(): DashboardColumnWidths {
  if (typeof window === 'undefined') return defaultDashboardColumnWidths()
  try {
    return hydrateDashboardColumnWidths(window.localStorage)
  } catch {
    return defaultDashboardColumnWidths()
  }
}

export function persistDashboardColumnWidths(
  widths: DashboardColumnWidths,
  storage?: DashboardColumnStorage | null,
): void {
  try {
    const target = storage === undefined
      ? (typeof window === 'undefined' ? null : window.localStorage)
      : storage
    if (!target) return

    const safeWidths = defaultDashboardColumnWidths()
    for (const column of DASHBOARD_COLUMNS) {
      safeWidths[column.id] = clampDashboardColumnWidth(column.id, widths[column.id])
    }
    target.setItem(
      DASHBOARD_COLUMN_STORAGE_KEY,
      JSON.stringify({ version: 2, widths: safeWidths }),
    )
  } catch {
    // Browser policy may deny storage; layout remains usable in memory.
  }
}

export type DashboardResizeKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'

export function reduceDashboardColumnWidth(
  columnId: DashboardColumnId,
  currentWidth: number,
  key: string,
  shiftKey = false,
): number {
  const column = COLUMN_BY_ID.get(columnId)
  if (!column) return currentWidth
  if (key === 'Home') return column.minWidth
  if (key === 'End') return column.maxWidth
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return currentWidth

  const step = shiftKey ? 24 : 8
  const delta = key === 'ArrowLeft' ? -step : step
  return clampDashboardColumnWidth(columnId, currentWidth + delta)
}

export function keyboardResizeWidth(
  column: DashboardColumn,
  width: number,
  key: string,
  shiftKey: boolean,
  pointerDragActive: boolean,
): number | null {
  if (pointerDragActive || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return null
  return reduceDashboardColumnWidth(column.id, width, key, shiftKey)
}

export function settleColumnResize(
  startWidth: number,
  latestWidth: number,
  commit: boolean,
): { width: number; persist: boolean } {
  return commit
    ? { width: latestWidth, persist: true }
    : { width: startWidth, persist: false }
}

export function claimColumnResize(
  coordinator: ColumnResizeCoordinator,
  columnId: DashboardColumnId,
  isPrimary: boolean,
  button: number,
): boolean {
  if (!isPrimary || button !== 0 || coordinator.activeColumnId !== null) return false
  coordinator.activeColumnId = columnId
  return true
}

export function releaseColumnResize(
  coordinator: ColumnResizeCoordinator,
  columnId: DashboardColumnId,
) {
  if (coordinator.activeColumnId === columnId) coordinator.activeColumnId = null
}

export function dashboardTableWidth(widths: DashboardColumnWidths): number {
  return DASHBOARD_COLUMNS.reduce((total, column) => total + widths[column.id], 0)
}

import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import {
  claimColumnResize,
  clampDashboardColumnWidth,
  keyboardResizeWidth,
  releaseColumnResize,
  settleColumnResize,
  type ColumnResizeCoordinator,
  type DashboardColumn,
} from '../lib/dashboardColumns'

interface ColumnResizeHandleProps {
  column: DashboardColumn
  width: number
  coordinator: ColumnResizeCoordinator
  onWidthChange: (width: number) => void
  onWidthCommit: (width: number) => void
}

interface ActiveDrag {
  pointerId: number
  startX: number
  startWidth: number
  latestWidth: number
  previousCursor: string
  previousUserSelect: string
}

export function ColumnResizeHandle({
  column,
  width,
  coordinator,
  onWidthChange,
  onWidthCommit,
}: ColumnResizeHandleProps) {
  const handleRef = useRef<HTMLDivElement>(null)
  const activeDrag = useRef<ActiveDrag | null>(null)

  function restoreDocumentStyles() {
    const drag = activeDrag.current
    if (!drag || typeof document === 'undefined') return
    document.body.style.cursor = drag.previousCursor
    document.body.style.userSelect = drag.previousUserSelect
  }

  function finishDrag(pointerId: number, commit: boolean) {
    const drag = activeDrag.current
    if (!drag || drag.pointerId !== pointerId) return
    const handle = handleRef.current
    if (handle?.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
    restoreDocumentStyles()
    activeDrag.current = null
    releaseColumnResize(coordinator, column.id)
    const settlement = settleColumnResize(drag.startWidth, drag.latestWidth, commit)
    if (settlement.persist) onWidthCommit(settlement.width)
    else onWidthChange(settlement.width)
  }

  useEffect(() => () => {
    const drag = activeDrag.current
    if (!drag) return
    restoreDocumentStyles()
    activeDrag.current = null
    releaseColumnResize(coordinator, column.id)
  }, [column.id, coordinator])

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (
      activeDrag.current ||
      !claimColumnResize(coordinator, column.id, event.isPrimary, event.button)
    ) return
    event.preventDefault()
    event.stopPropagation()
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    activeDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
      latestWidth: width,
      previousCursor,
      previousUserSelect,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = activeDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const nextWidth = clampDashboardColumnWidth(
      column.id,
      drag.startWidth + event.clientX - drag.startX,
    )
    drag.latestWidth = nextWidth
    onWidthChange(nextWidth)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const nextWidth = keyboardResizeWidth(
      column,
      width,
      event.key,
      event.shiftKey,
      coordinator.activeColumnId !== null,
    )
    if (nextWidth === null) return
    event.preventDefault()
    event.stopPropagation()
    onWidthChange(nextWidth)
    onWidthCommit(nextWidth)
  }

  return (
    <div
      ref={handleRef}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={`Resize ${column.label} column`}
      aria-valuemin={column.minWidth}
      aria-valuemax={column.maxWidth}
      aria-valuenow={Math.round(width)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => finishDrag(event.pointerId, true)}
      onPointerCancel={(event) => finishDrag(event.pointerId, false)}
      className="group absolute inset-y-0 -right-2 z-10 w-4 cursor-col-resize touch-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-900 [@media(pointer:coarse)]:-right-[22px] [@media(pointer:coarse)]:w-11 dark:focus-visible:outline-zinc-100"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100 dark:bg-zinc-500"
      />
    </div>
  )
}

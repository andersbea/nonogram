import { memo, useEffect, useRef } from "react"
import { X } from "lucide-react"
import { ITEMS } from "@/game/items"
import type { Cell as CellT } from "@/game/types"
import { ITEM_ICONS } from "@/lib/item-icons"
import { multiTouchRef } from "@/lib/touch-state"
import { cn } from "@/lib/utils"

interface Props {
  cell: CellT
  row: number
  col: number
  size: number
  wrongFlash: boolean
  scanning: boolean
  markMode: boolean
  onFill: (r: number, c: number) => void
  onMark: (r: number, c: number) => void
  onCollect: (r: number, c: number) => void
}

const LONG_PRESS_MS = 280
// Finger contact points jitter during a long hold — sometimes 30+ px between
// samples. Generous threshold so a steady press isn't canceled by drift.
const MOVE_TOLERANCE_PX = 48
// Android Chrome sometimes fires a synthetic click after a long-press even
// when we called preventDefault on touchend. Drop any click that arrives
// within this window of the last touchend on this cell.
const SYNTHETIC_CLICK_SUPPRESS_MS = 600

function CellInner({
  cell,
  row,
  col,
  size,
  wrongFlash,
  scanning,
  markMode,
  onFill,
  onMark,
  onCollect,
}: Props) {
  const isFilled = cell.state === "filled"
  const isMarked = cell.state === "marked"
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  // Timestamp of the most recent touchend on this cell. We use it to ignore
  // any synthetic click event the browser emits despite our preventDefault.
  const lastTouchEndAt = useRef(0)

  // Live ref into the latest props/state. The native touch listener below is
  // attached once and reads from this ref every fire — that way it always
  // sees the current `markMode`, `cell`, etc. without needing to be re-bound
  // on every render.
  const live = useRef({ isFilled, cell, markMode, onFill, onMark, onCollect, row, col })
  live.current = { isFilled, cell, markMode, onFill, onMark, onCollect, row, col }

  // Touch handling has to coexist with browser-native panning:
  //   - touchstart: start the long-press timer, but DON'T preventDefault.
  //     Letting the browser see the gesture lets it start a scroll if the
  //     player drags.
  //   - touchmove past threshold: cancel the timer — this is a pan, not a tap.
  //   - touchend: if the timer fired (long-press), call onMark and suppress
  //     the synthetic click that follows. Otherwise let the browser emit a
  //     normal click event, which `handleClick` below converts to a fill.
  useEffect(() => {
    const el = buttonRef.current
    if (!el) return

    let timer: number | null = null
    let longPressFired = false
    let startX = 0
    let startY = 0
    const clearTimer = () => {
      if (timer != null) {
        clearTimeout(timer)
        timer = null
      }
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        // A second finger landed (or more) — abort the long-press timer so
        // pinch / multi-touch gestures don't accidentally place a mark.
        clearTimer()
        return
      }
      const t = e.touches[0]
      startX = t.clientX
      startY = t.clientY
      longPressFired = false
      clearTimer()
      timer = window.setTimeout(() => {
        if (multiTouchRef.current > 1) return
        if (!live.current.isFilled) {
          live.current.onMark(live.current.row, live.current.col)
          if ("vibrate" in navigator) navigator.vibrate(15)
        }
      }, LONG_PRESS_MS)
    }

    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0]
      if (!t) return
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      if (dx * dx + dy * dy > MOVE_TOLERANCE_PX * MOVE_TOLERANCE_PX) clearTimer()
    }

    const onTouchEnd = (e: TouchEvent) => {
      clearTimer()
      if (longPressFired) {
        e.preventDefault()
        lastTouchEndAt.current = Date.now()
      }
    }

    const onTouchCancel = () => {
      clearTimer()
      longPressFired = false
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true })
    el.addEventListener("touchmove", onTouchMove, { passive: true })
    el.addEventListener("touchend", onTouchEnd, { passive: false })
    el.addEventListener("touchcancel", onTouchCancel, { passive: true })
    return () => {
      clearTimer()
      el.removeEventListener("touchstart", onTouchStart)
      el.removeEventListener("touchmove", onTouchMove)
      el.removeEventListener("touchend", onTouchEnd)
      el.removeEventListener("touchcancel", onTouchCancel)
    }
  }, [])

  // Mouse / keyboard path: regular click handler. Touch *shouldn't* reach
  // this because touchstart called preventDefault — but Android Chrome
  // occasionally fires the synthetic click anyway. Drop any click that
  // arrives within 600ms of a touchend on this cell.
  const handleClick = (e: React.MouseEvent) => {
    if (Date.now() - lastTouchEndAt.current < SYNTHETIC_CLICK_SUPPRESS_MS) return
    if (e.shiftKey || e.altKey) {
      onMark(row, col)
      return
    }
    if (isFilled) {
      if (cell.item) onCollect(row, col)
      return
    }
    if (isMarked) return
    if (markMode) onMark(row, col)
    else onFill(row, col)
  }

  const handleContext = (e: React.MouseEvent) => {
    e.preventDefault()
    if (!isFilled) onMark(row, col)
  }

  const ItemIcon = cell.item ? ITEM_ICONS[cell.item] : null

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={handleClick}
      onContextMenu={handleContext}
      draggable={false}
      style={{
        width: size,
        height: size,
        WebkitTouchCallout: "none",
        WebkitTapHighlightColor: "transparent",
      }}
      className={cn(
        "relative flex select-none items-center justify-center rounded-md transition-all duration-150 touch-manipulation",
        !isFilled &&
          !isMarked &&
          "bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:bg-[var(--color-border)] hover:border-[var(--color-accent)]/60",
        isMarked &&
          "bg-[var(--color-surface-2)]/60 border border-[var(--color-border)]/60",
        isFilled &&
          "bg-[var(--color-fg)] border border-[var(--color-fg)] cell-reveal",
        wrongFlash && "bg-[var(--color-danger)]/40 border border-[var(--color-danger)]/70",
      )}
      aria-label={`Cell ${row + 1},${col + 1}${isFilled && cell.item ? ` — collect ${ITEMS[cell.item].name}` : ""}`}
      data-cell-state={isMarked ? "marked" : isFilled ? "filled" : "hidden"}
      data-row={row}
      data-col={col}
    >
      {!isFilled && !isMarked && cell.bonus && (
        <span className="absolute inset-0 rounded-md opacity-30 [background:radial-gradient(circle_at_center,var(--color-flag),transparent_70%)] pointer-events-none" />
      )}

      {scanning && cell.solution && !isFilled && (
        <span className="pointer-events-none absolute inset-0 animate-pulse rounded-md bg-[var(--color-success)]/40 ring-2 ring-[var(--color-success)]/70" />
      )}

      {isMarked && (
        <X
          className="cell-pop text-[var(--color-fg-soft)]"
          style={{ width: Math.max(12, size * 0.4), height: Math.max(12, size * 0.4) }}
          strokeWidth={2.5}
        />
      )}

      {isFilled && cell.bonus && !cell.item && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <span
            className="rounded-full bg-[var(--color-flag)] cell-pop"
            style={{ width: Math.max(4, size * 0.14), height: Math.max(4, size * 0.14) }}
          />
        </span>
      )}

      {isFilled && ItemIcon && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <span className="cell-pop animate-pulse rounded-full bg-[var(--color-accent)]/30 p-1 text-[var(--color-bg)] ring-2 ring-[var(--color-accent)]">
            <ItemIcon className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
        </span>
      )}
    </button>
  )
}

export const Cell = memo(CellInner)

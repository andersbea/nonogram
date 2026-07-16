import { memo } from "react"
import { X } from "lucide-react"
import { ITEMS } from "@/game/items"
import type { Cell as CellT } from "@/game/types"
import { ITEM_ICONS } from "@/lib/item-icons"
import { cn } from "@/lib/utils"

interface Props {
  cell: CellT
  row: number
  col: number
  size: number
  wrongFlash: boolean
  scanning: boolean
  /** Thicker divider on the right/bottom edge, drawn every 5 cells like a
   *  standard nonogram grid so players can count position at a glance. */
  blockRight: boolean
  blockBottom: boolean
}

const GRID_LINE = "color-mix(in oklch, var(--color-fg) 32%, var(--color-border))"

// All pointer/touch handling lives in Board.tsx now — it needs to track the
// gesture across cell boundaries to support drag-painting a whole row/column
// in one stroke, which a single cell can't do on its own.
function CellInner({ cell, row, col, size, wrongFlash, scanning, blockRight, blockBottom }: Props) {
  const isFilled = cell.state === "filled"
  const isMarked = cell.state === "marked"
  const ItemIcon = cell.item ? ITEM_ICONS[cell.item] : null

  const shadows = [
    blockRight && `2px 0 0 0 ${GRID_LINE}`,
    blockBottom && `0 2px 0 0 ${GRID_LINE}`,
  ].filter(Boolean)

  return (
    <button
      type="button"
      draggable={false}
      style={{
        width: size,
        height: size,
        WebkitTouchCallout: "none",
        WebkitTapHighlightColor: "transparent",
        touchAction: "none",
        boxShadow: shadows.length ? shadows.join(", ") : undefined,
      }}
      className={cn(
        "relative flex select-none items-center justify-center rounded-md transition-colors duration-150",
        !isFilled &&
          !isMarked &&
          "bg-[var(--color-surface-2)] border border-[var(--color-border)]",
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Minimize2 } from "lucide-react"
import { colStates, lineSatisfied, rowStates } from "@/game/engine"
import type { Board as BoardT, Clues } from "@/game/types"
import { Cell } from "./Cell"
import { cn } from "@/lib/utils"

const MAX_SCALE = 2.5

// Fit a `rows × cols` puzzle grid (plus its clue headers) inside a
// `width × height` viewport. Cells are kept at a comfortable tap-friendly
// minimum even if that means the board no longer fits — the outer container
// is scrollable, so the player can pan to reach the rest.
function fitCells(
  rows: number,
  cols: number,
  width: number,
  height: number,
  maxRowClueLen: number,
  maxColClueLen: number,
) {
  const compact = width < 480
  const padding = compact ? 6 : 12
  const gap = compact ? 2 : 3
  const MIN_CELL = compact ? 24 : 28
  const MAX_CELL = 48
  // Reserve "phantom" cells worth of space for the clue headers up front so
  // the fit calculation accounts for them without a second measuring pass.
  const headerCols = Math.min(3, Math.max(1.2, maxRowClueLen * 0.65))
  const headerRows = Math.min(3, Math.max(1.2, maxColClueLen * 0.55))
  const availW = Math.max(0, width - padding * 2)
  const availH = Math.max(0, height - padding * 2)
  const byWidth = Math.floor((availW - (cols - 1 + headerCols) * gap) / (cols + headerCols))
  const byHeight = Math.floor((availH - (rows - 1 + headerRows) * gap) / (rows + headerRows))
  const cellSize = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.min(byWidth, byHeight)))
  return { cellSize, gap, padding }
}

interface Props {
  board: BoardT
  clues: Clues
  wrongFlash: [number, number] | null
  shake: boolean
  scanning: boolean
  markMode: boolean
  onFill: (r: number, c: number) => void
  onMark: (r: number, c: number) => void
  onCollect: (r: number, c: number) => void
}

export function Board({
  board,
  clues,
  wrongFlash,
  shake,
  scanning,
  markMode,
  onFill,
  onMark,
  onCollect,
}: Props) {
  const rows = board.length
  const cols = board[0]?.length ?? 0
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  // Zoom level (1 = neutral; max is MAX_SCALE, min is computed dynamically
  // so the board can always be fully zoomed-out into view).
  const [scale, setScale] = useState(1)
  const scaleRef = useRef(1)
  scaleRef.current = scale
  // minScaleRef is updated every render (below) so the pinch handler — which
  // is only attached once — always reads the current value without needing a
  // re-bind.
  const minScaleRef = useRef(0.4)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect
      setContainerSize({ width: rect.width, height: rect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Pinch-zoom + two-finger pan on the scroll container. The browser
  // already handles one-finger scrolling via `touch-action: pan-x pan-y`,
  // so this hook only kicks in for two-finger gestures.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const distance = (t1: Touch, t2: Touch) =>
      Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
    const centroid = (touches: TouchList) => ({
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    })

    type PinchStart = {
      dist: number
      scale: number
      pointer: { x: number; y: number }
      scrollLeft: number
      scrollTop: number
    }
    let pinch: PinchStart | null = null

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length < 2) return
      // Two-finger gesture — claim it from the browser so we drive both
      // zoom and pan ourselves.
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const c = centroid(e.touches)
      pinch = {
        dist: distance(e.touches[0], e.touches[1]),
        scale: scaleRef.current,
        pointer: { x: c.x - rect.left, y: c.y - rect.top },
        scrollLeft: el.scrollLeft,
        scrollTop: el.scrollTop,
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length < 2 || !pinch) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const d = distance(e.touches[0], e.touches[1])
      const c = centroid(e.touches)
      const pointer = { x: c.x - rect.left, y: c.y - rect.top }
      const next = Math.max(
        minScaleRef.current,
        Math.min(MAX_SCALE, pinch.scale * (d / pinch.dist)),
      )

      // Anchor the gesture: the document point under the original centroid
      // should stay under the current centroid as we scale.
      const docX = (pinch.pointer.x + pinch.scrollLeft) / pinch.scale
      const docY = (pinch.pointer.y + pinch.scrollTop) / pinch.scale
      setScale(next)
      // Scroll to keep that doc point under the live centroid, accounting
      // for the centroid having moved (two-finger pan).
      el.scrollLeft = docX * next - pointer.x
      el.scrollTop = docY * next - pointer.y
    }

    const onTouchEnd = () => {
      pinch = null
    }

    el.addEventListener("touchstart", onTouchStart, { passive: false })
    el.addEventListener("touchmove", onTouchMove, { passive: false })
    el.addEventListener("touchend", onTouchEnd, { passive: true })
    el.addEventListener("touchcancel", onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener("touchstart", onTouchStart)
      el.removeEventListener("touchmove", onTouchMove)
      el.removeEventListener("touchend", onTouchEnd)
      el.removeEventListener("touchcancel", onTouchEnd)
    }
  }, [])

  // Helper: scroll the viewport so the board is centred. Two rAFs let React
  // flush the new padding into the DOM before we read scrollWidth/scrollHeight.
  const centerScroll = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = containerRef.current
        if (!el) return
        el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2)
        el.scrollTop = Math.max(0, (el.scrollHeight - el.clientHeight) / 2)
      })
    })
  }, [])

  // Reset scale to neutral and re-centre when the board changes (new level /
  // new run). Using rows/cols as a proxy avoids resetting on every fill.
  useEffect(() => {
    setScale(1)
    centerScroll()
  }, [rows, cols, centerScroll])

  const maxRowClueLen = useMemo(
    () => Math.max(1, ...clues.rows.map((c) => c.length)),
    [clues.rows],
  )
  const maxColClueLen = useMemo(
    () => Math.max(1, ...clues.cols.map((c) => c.length)),
    [clues.cols],
  )

  const { cellSize, gap, padding } = useMemo(
    () => fitCells(rows, cols, containerSize.width, containerSize.height, maxRowClueLen, maxColClueLen),
    [rows, cols, containerSize, maxRowClueLen, maxColClueLen],
  )

  const clueFont = Math.max(9, Math.round(cellSize * 0.32))
  const rowHeaderW = Math.max(cellSize, Math.round(maxRowClueLen * (clueFont * 0.62 + 4) + 10))
  const colHeaderH = Math.max(cellSize, Math.round(maxColClueLen * (clueFont + 3) + 10))

  const naturalWidth =
    padding * 2 + rowHeaderW + gap + cols * cellSize + Math.max(0, cols - 1) * gap
  const naturalHeight =
    padding * 2 + colHeaderH + gap + rows * cellSize + Math.max(0, rows - 1) * gap

  // Half-viewport padding on each side so the board edge can pan to the
  // centre of the screen. Falls back to 0 before the container is measured.
  const panPadX = containerSize.width > 0 ? Math.round(containerSize.width / 2) : 0
  const panPadY = containerSize.height > 0 ? Math.round(containerSize.height / 2) : 0

  // Minimum scale: allow zooming out until the board fills the viewport with a
  // small margin. Floor at 0.2 so tiny boards don't get weirdly microscopic.
  const FIT_MARGIN = 16
  const minScale =
    containerSize.width > 0 && naturalWidth > 0
      ? Math.max(
          0.2,
          Math.min(
            1, // never force zoom-in beyond 1:1 just to "fit"
            (containerSize.width - FIT_MARGIN * 2) / naturalWidth,
            (containerSize.height - FIT_MARGIN * 2) / naturalHeight,
          ),
        )
      : 0.4
  minScaleRef.current = minScale

  const scaledWidth = naturalWidth * scale
  const scaledHeight = naturalHeight * scale

  const rowDone = useMemo(
    () => board.map((_, r) => lineSatisfied(rowStates(board, r), clues.rows[r])),
    [board, clues.rows],
  )
  const colDone = useMemo(
    () => Array.from({ length: cols }, (_, c) => lineSatisfied(colStates(board, c), clues.cols[c])),
    [board, clues.cols, cols],
  )

  const zoomed = Math.abs(scale - 1) > 0.05

  // Arrow-key navigation: delegate from the grid container so we don't need a
  // handler on every cell. `data-row` / `data-col` attributes on each button
  // (set by Cell.tsx) provide the position without parsing the aria-label.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName !== "BUTTON") return
      const r = Number(target.getAttribute("data-row"))
      const c = Number(target.getAttribute("data-col"))
      if (isNaN(r) || isNaN(c)) return

      let nr = r
      let nc = c
      switch (e.key) {
        case "ArrowUp":    nr = r - 1; break
        case "ArrowDown":  nr = r + 1; break
        case "ArrowLeft":  nc = c - 1; break
        case "ArrowRight": nc = c + 1; break
        default: return
      }
      e.preventDefault()
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return
      const next = containerRef.current?.querySelector(
        `button[data-row="${nr}"][data-col="${nc}"]`,
      ) as HTMLElement | null
      next?.focus()
    },
    [rows, cols],
  )

  return (
    // Outer scroll viewport. One-finger drag scrolls natively (touch-action),
    // two-finger drag scales+pans via the effect above.
    <div
      ref={containerRef}
      className="board-scroll relative h-full w-full overflow-auto overscroll-contain [touch-action:pan-x_pan-y]"
    >
      {/* Wrapper sized to at least the scroll viewport. Half-viewport padding
          on every side gives the player enough room to pan until any edge of
          the board reaches the centre of the screen. `m-auto` centres the
          board inside the padded flex container when there is leftover space. */}
      <div
        className="flex min-h-full min-w-full"
        style={{
          paddingLeft: panPadX,
          paddingRight: panPadX,
          paddingTop: panPadY,
          paddingBottom: panPadY,
        }}
      >
        <div
          className="relative m-auto shrink-0"
          style={{ width: scaledWidth, height: scaledHeight }}
        >
          {/* Board card itself, sized to natural dimensions and CSS-scaled
              to the current zoom level. */}
          <div
            className={cn(
              "absolute left-0 top-0 origin-top-left rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/85 backdrop-blur-xl",
              "shadow-[0_30px_80px_-30px_color-mix(in_oklch,var(--color-accent)_30%,transparent)]",
              shake && "shake",
            )}
            style={{
              padding,
              width: naturalWidth,
              height: naturalHeight,
              transform: `scale(${scale})`,
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div
              role="grid"
              aria-label={`Nonogram board, ${rows} rows by ${cols} columns`}
              aria-rowcount={rows}
              aria-colcount={cols}
              className="grid"
              style={{
                gridTemplateColumns: `${rowHeaderW}px repeat(${cols}, ${cellSize}px)`,
                gridTemplateRows: `${colHeaderH}px repeat(${rows}, ${cellSize}px)`,
                gap: `${gap}px`,
              }}
              onKeyDown={handleKeyDown}
            >
              {/* Corner spacer */}
              <div style={{ gridRow: 1, gridColumn: 1 }} />

              {/* Column clue headers */}
              {clues.cols.map((clue, c) => (
                <div
                  key={`col-${c}`}
                  aria-hidden
                  className={cn(
                    "flex flex-col items-center justify-end gap-0.5 font-mono leading-none",
                    colDone[c]
                      ? "text-[var(--color-muted)]/50 line-through decoration-2"
                      : "text-[var(--color-fg-soft)]",
                  )}
                  style={{ gridRow: 1, gridColumn: c + 2, fontSize: clueFont }}
                >
                  {clue.map((n, i) => (
                    <span key={i}>{n}</span>
                  ))}
                </div>
              ))}

              {/* Row clue headers */}
              {clues.rows.map((clue, r) => (
                <div
                  key={`row-${r}`}
                  aria-hidden
                  className={cn(
                    "flex flex-row items-center justify-end gap-1.5 pr-1.5 font-mono leading-none",
                    rowDone[r]
                      ? "text-[var(--color-muted)]/50 line-through decoration-2"
                      : "text-[var(--color-fg-soft)]",
                  )}
                  style={{ gridRow: r + 2, gridColumn: 1, fontSize: clueFont }}
                >
                  {clue.map((n, i) => (
                    <span key={i}>{n}</span>
                  ))}
                </div>
              ))}

              {/* Puzzle cells */}
              {board.map((row, r) =>
                row.map((cell, c) => (
                  <div key={`${r}-${c}`} style={{ gridRow: r + 2, gridColumn: c + 2 }}>
                    <Cell
                      cell={cell}
                      row={r}
                      col={c}
                      size={cellSize}
                      wrongFlash={wrongFlash ? wrongFlash[0] === r && wrongFlash[1] === c : false}
                      scanning={scanning}
                      markMode={markMode}
                      onFill={onFill}
                      onMark={onMark}
                      onCollect={onCollect}
                    />
                  </div>
                )),
              )}
            </div>
          </div>
        </div>
      </div>
      {zoomed && (
        <button
          type="button"
          onClick={() => { setScale(1); centerScroll() }}
          aria-label="Reset zoom"
          className="sticky bottom-3 left-[calc(100%-3.5rem)] z-10 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/90 text-[var(--color-fg)] shadow-lg backdrop-blur transition-all hover:bg-[var(--color-surface-2)] active:scale-95"
        >
          <Minimize2 className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

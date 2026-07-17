import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Minimize2 } from "lucide-react"
import { colStates, lineSatisfied, rowStates } from "@/game/engine"
import type { Board as BoardT, Clues } from "@/game/types"
import { Cell } from "./Cell"
import { cn } from "@/lib/utils"

const MAX_SCALE = 2.5
// Standard nonogram convention: a bolder divider every 5 cells so players
// can count position in a large grid at a glance.
const BLOCK_SIZE = 5

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
  const headerCols = Math.min(3, Math.max(1.4, maxRowClueLen * 0.75))
  const headerRows = Math.min(3, Math.max(1.4, maxColClueLen * 0.65))
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

type PaintAction = "fill" | "mark" | "unmark"

/** What a stroke starting on this cell should do, given the current tool. */
function actionForCell(board: BoardT, r: number, c: number, markMode: boolean): PaintAction | "collect" | null {
  const cell = board[r]?.[c]
  if (!cell) return null
  if (cell.state === "filled") return cell.item ? "collect" : null
  if (cell.state === "marked") return markMode ? "unmark" : null
  return markMode ? "mark" : "fill"
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
  const gridRef = useRef<HTMLDivElement | null>(null)
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

  // Live ref so the gesture handlers (bound once) always see the current
  // board/mode/callbacks without needing to be re-attached on every render.
  const liveRef = useRef({ board, markMode, onFill, onMark, onCollect })
  liveRef.current = { board, markMode, onFill, onMark, onCollect }

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

  // ── Drag-to-paint ──────────────────────────────────────────────────────
  // Standard nonogram interaction: press a cell and drag across a row/column
  // to fill or mark every cell the finger crosses in one stroke. A single
  // tap (no movement) is handled by the native `click` event instead — a
  // real click/keyboard-activation click only fires when press and release
  // land on the same element, so it never double-fires alongside a drag.
  type DragSession = {
    action: PaintAction | null
    originR: number
    originC: number
    dragging: boolean
    visited: Set<string>
  }
  const dragRef = useRef<DragSession | null>(null)

  const cellAt = useCallback((x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    const btn = el?.closest("button[data-row]") as HTMLElement | null
    if (!btn) return null
    const r = Number(btn.getAttribute("data-row"))
    const c = Number(btn.getAttribute("data-col"))
    if (Number.isNaN(r) || Number.isNaN(c)) return null
    return { r, c }
  }, [])

  // Every board-mutating action — taps, right-clicks, and drag strokes —
  // funnels through this one queue, drained one item per animation frame.
  // That serialization is load-bearing, not just a drag-specific nicety:
  // calling onFill/onMark synchronously for several cells in the same tick
  // is unsafe, because each call reads `board`/`status`/etc. from the same
  // pre-commit closure (via liveRef) — React's batched setState then only
  // keeps the *last* of several same-tick updates. That silently drops
  // earlier cells in a drag stroke, and for taps it's worse: a burst of
  // fast clicks can each read the same stale mistake count, so the loss
  // check race-conditions past its own threshold instead of stopping the
  // round. One item per frame guarantees each call sees the previous
  // item's already-committed result before deciding the next one.
  type QueueItem =
    | { kind: "fill"; r: number; c: number; forced: boolean }
    | { kind: "mark"; r: number; c: number }
    | { kind: "unmark"; r: number; c: number }
    | { kind: "toggleMark"; r: number; c: number }
    | { kind: "collect"; r: number; c: number }

  const queueRef = useRef<QueueItem[]>([])
  const drainingRef = useRef(false)

  const enqueue = useCallback((item: QueueItem) => {
    queueRef.current.push(item)
    if (drainingRef.current) return
    drainingRef.current = true

    // A hoisted local function (rather than a self-referencing const) so it
    // can recurse via requestAnimationFrame without a temporal-dead-zone
    // self-reference in its own initializer.
    function drainOne() {
      const next = queueRef.current.shift()
      if (!next) {
        drainingRef.current = false
        return
      }
      const { board: b, onFill: fill, onMark: mark, onCollect: collect } = liveRef.current
      const cell = b[next.r]?.[next.c]
      if (cell) {
        if (next.kind === "fill") {
          // Drag-fill (forced: false) only paints cells that are actually
          // correct, so a sloppy swipe across a run can't rack up a cascade
          // of mistakes. A deliberate tap (forced: true) always attempts the
          // fill — it can still be wrong; Game.tsx's handleFill is what
          // charges the mistake and checks the loss threshold.
          if (cell.state === "hidden" && (next.forced || cell.solution)) fill(next.r, next.c)
        } else if (next.kind === "mark") {
          if (cell.state === "hidden") mark(next.r, next.c)
        } else if (next.kind === "unmark") {
          if (cell.state === "marked") mark(next.r, next.c)
        } else if (next.kind === "toggleMark") {
          if (cell.state !== "filled") mark(next.r, next.c)
        } else if (next.kind === "collect") {
          if (cell.state === "filled" && cell.item) collect(next.r, next.c)
        }
      }
      requestAnimationFrame(drainOne)
    }
    requestAnimationFrame(drainOne)
  }, [])

  const beginDrag = useCallback((r: number, c: number) => {
    const action = actionForCell(liveRef.current.board, r, c, liveRef.current.markMode)
    dragRef.current = {
      action: action === "collect" || action === null ? null : action,
      originR: r,
      originC: c,
      dragging: false,
      visited: new Set(),
    }
  }, [])

  const continueDrag = useCallback(
    (r: number, c: number) => {
      const session = dragRef.current
      if (!session) return false
      if (r === session.originR && c === session.originC && !session.dragging) return false
      const enqueueDragCell = (dr: number, dc: number) => {
        if (!session.action) return
        if (session.action === "fill") {
          enqueue({ kind: "fill", r: dr, c: dc, forced: false })
          return
        }
        const cell = liveRef.current.board[dr]?.[dc]
        enqueue({ kind: session.action, r: dr, c: dc })
        // Marking is otherwise free, but a sloppy swipe shouldn't blast an
        // X across a whole run once it's crossed into a cell that's
        // actually part of the solution. That one mark still lands — it's
        // already enqueued above — but the stroke halts there, so nothing
        // further along the same drag gets marked.
        //
        // Only halt on a *new* incorrect mark — a cell that's already
        // marked (from earlier in this stroke, an earlier stroke, or a
        // tap) is a no-op either way, so swiping back over it shouldn't
        // cancel the rest of the drag. That matters once a row is mostly
        // marked already and the stroke just needs to reach a few
        // remaining hidden cells past it.
        if (session.action === "mark" && cell?.state === "hidden" && cell.solution) {
          session.action = null
        }
      }
      if (!session.dragging) {
        session.dragging = true
        session.visited.add(`${session.originR}-${session.originC}`)
        enqueueDragCell(session.originR, session.originC)
      }
      const key = `${r}-${c}`
      if (session.action && !session.visited.has(key)) {
        session.visited.add(key)
        enqueueDragCell(r, c)
      }
      return true
    },
    [enqueue],
  )

  // Touch: a stroke that starts on a cell always paints, never pans — cells
  // are `touch-action:none` so the browser never claims the gesture for
  // native scrolling. A stroke that starts off a cell (the padded margin
  // around the board) is left alone entirely, so it pans normally.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        dragRef.current = null
        return
      }
      const t = e.touches[0]
      const hit = cellAt(t.clientX, t.clientY)
      if (!hit) return
      beginDrag(hit.r, hit.c)
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!dragRef.current || e.touches.length !== 1) return
      const t = e.touches[0]
      const hit = cellAt(t.clientX, t.clientY)
      if (!hit) return
      if (continueDrag(hit.r, hit.c)) e.preventDefault()
    }

    const onTouchEnd = () => {
      dragRef.current = null
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true })
    el.addEventListener("touchmove", onTouchMove, { passive: false })
    el.addEventListener("touchend", onTouchEnd, { passive: true })
    el.addEventListener("touchcancel", onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener("touchstart", onTouchStart)
      el.removeEventListener("touchmove", onTouchMove)
      el.removeEventListener("touchend", onTouchEnd)
      el.removeEventListener("touchcancel", onTouchEnd)
    }
  }, [cellAt, beginDrag, continueDrag])

  // Mouse: primary-button drag paints the same way touch does. A plain
  // click (no movement) is left to the onClick handler below.
  const handleGridMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      const btn = (e.target as HTMLElement).closest("button[data-row]") as HTMLElement | null
      if (!btn) return
      const r = Number(btn.getAttribute("data-row"))
      const c = Number(btn.getAttribute("data-col"))
      if (Number.isNaN(r) || Number.isNaN(c)) return
      beginDrag(r, c)

      const onMove = (ev: MouseEvent) => {
        const hit = cellAt(ev.clientX, ev.clientY)
        if (hit) continueDrag(hit.r, hit.c)
      }
      const onUp = () => {
        dragRef.current = null
        window.removeEventListener("mousemove", onMove)
        window.removeEventListener("mouseup", onUp)
      }
      window.addEventListener("mousemove", onMove)
      window.addEventListener("mouseup", onUp)
    },
    [beginDrag, cellAt, continueDrag],
  )

  // A tap/click (no drag) — also the path for keyboard Enter/Space
  // activation, which fires `click` directly with no preceding mousedown.
  //
  // Handled directly rather than through `enqueue`: each discrete click is
  // its own browser event/task, and React already flushes state between
  // separate events, so there's no same-tick staleness to guard against
  // here (unlike a drag stroke, where one `touchmove` can cross several
  // cells inside a single synchronous handler call). Routing taps through
  // the rAF-driven queue was tried and reverted — `requestAnimationFrame`
  // callbacks are throttled to nothing on a backgrounded/unfocused tab, so
  // a tap could end up silently doing nothing.
  const handleGridClick = useCallback((e: React.MouseEvent) => {
    const btn = (e.target as HTMLElement).closest("button[data-row]") as HTMLElement | null
    if (!btn) return
    const r = Number(btn.getAttribute("data-row"))
    const c = Number(btn.getAttribute("data-col"))
    if (Number.isNaN(r) || Number.isNaN(c)) return
    const { board: b, onFill: fill, onMark: mark, onCollect: collect } = liveRef.current
    if (e.shiftKey || e.altKey) {
      mark(r, c)
      return
    }
    const action = actionForCell(b, r, c, liveRef.current.markMode)
    if (action === "collect") collect(r, c)
    else if (action === "fill") fill(r, c) // deliberate single tap — full mistake risk allowed
    else if (action === "mark" || action === "unmark") mark(r, c)
  }, [])

  const handleGridContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const btn = (e.target as HTMLElement).closest("button[data-row]") as HTMLElement | null
    if (!btn) return
    const r = Number(btn.getAttribute("data-row"))
    const c = Number(btn.getAttribute("data-col"))
    if (Number.isNaN(r) || Number.isNaN(c)) return
    const cell = liveRef.current.board[r]?.[c]
    if (cell && cell.state !== "filled") liveRef.current.onMark(r, c)
  }, [])

  // Pinch-zoom + two-finger pan on the scroll container. The browser
  // already handles one-finger scrolling via `touch-action: pan-x pan-y`
  // for strokes that start off the board (see the drag-paint effect above
  // for strokes that start on a cell).
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
      // Two-finger gesture — claim it from the browser (and cancel any
      // in-flight paint stroke) so we drive both zoom and pan ourselves.
      dragRef.current = null
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
  // new run) OR when the container is (re)measured. The latter matters on
  // first mount: the very first render has containerSize={0,0} (padding not
  // applied yet), so centering must re-run once the real size lands —
  // otherwise the scroll position gets "baked in" from that zero-padding
  // layout and never catches up once the real padding appears.
  useEffect(() => {
    setScale(1)
    centerScroll()
  }, [rows, cols, containerSize.width, containerSize.height, centerScroll])

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
  const rowHeaderW = Math.max(cellSize, Math.round(maxRowClueLen * (clueFont * 0.62 + 4) + 16))
  const colHeaderH = Math.max(cellSize, Math.round(maxColClueLen * (clueFont + 6) + 12))

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
  // provide the position without parsing the aria-label.
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
      const next = gridRef.current?.querySelector(
        `button[data-row="${nr}"][data-col="${nc}"]`,
      ) as HTMLElement | null
      next?.focus()
    },
    [rows, cols],
  )

  return (
    // Outer scroll viewport. One-finger drag scrolls natively when it starts
    // off the board (touch-action); on a cell it paints instead (see the
    // drag-paint effect above). Two-finger drag always scales+pans.
    <div
      ref={containerRef}
      className="board-scroll relative h-full w-full overflow-auto overscroll-contain [touch-action:pan-x_pan-y]"
    >
      {/* Wrapper explicitly sized to padding + content (border-box), so it's
          always exactly as big as its own overflow — never smaller. That
          matters because a `min-width` floor alone lets the padded content
          overflow the box, and CSS resolves `margin: auto` on an overflowing
          flex child to 0 instead of centering it, breaking symmetry. Half-
          viewport padding on every side gives the player enough room to pan
          until any edge of the board reaches the centre of the screen. */}
      <div
        className="flex box-border"
        style={{
          width: Math.max(containerSize.width, panPadX * 2 + scaledWidth),
          height: Math.max(containerSize.height, panPadY * 2 + scaledHeight),
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
          >
            <div
              ref={gridRef}
              role="grid"
              aria-label={`Nonogram board, ${rows} rows by ${cols} columns`}
              aria-rowcount={rows}
              aria-colcount={cols}
              className="grid"
              style={{
                gridTemplateColumns: `${rowHeaderW}px repeat(${cols}, ${cellSize}px)`,
                gridTemplateRows: `${colHeaderH}px repeat(${rows}, ${cellSize}px)`,
              }}
              onKeyDown={handleKeyDown}
              onMouseDown={handleGridMouseDown}
              onClick={handleGridClick}
              onContextMenu={handleGridContextMenu}
            >
              {/* Corner spacer */}
              <div style={{ gridRow: 1, gridColumn: 1 }} />

              {/* Column clue headers — one small chip per number, stacked. */}
              {clues.cols.map((clue, c) => (
                <div
                  key={`col-${c}`}
                  aria-hidden
                  className="flex flex-col items-center justify-end gap-[3px] pb-[3px]"
                  style={{ gridRow: 1, gridColumn: c + 2 }}
                >
                  {clue.map((n, i) => (
                    <span
                      key={i}
                      className={cn(
                        "flex items-center justify-center rounded-[5px] font-mono leading-none transition-colors",
                        colDone[c]
                          ? "bg-transparent text-[var(--color-muted)]/50 line-through decoration-2"
                          : "bg-[var(--color-surface-2)] text-[var(--color-fg-soft)]",
                      )}
                      style={{
                        fontSize: clueFont,
                        minWidth: clueFont * 1.5,
                        padding: `${Math.max(1, clueFont * 0.18)}px ${Math.max(2, clueFont * 0.3)}px`,
                      }}
                    >
                      {n}
                    </span>
                  ))}
                </div>
              ))}

              {/* Row clue headers — one pill per row. */}
              {clues.rows.map((clue, r) => (
                <div
                  key={`row-${r}`}
                  aria-hidden
                  className="flex items-center justify-end pr-[3px]"
                  style={{ gridRow: r + 2, gridColumn: 1 }}
                >
                  <span
                    className={cn(
                      "flex items-center justify-end gap-[6px] rounded-full font-mono leading-none transition-colors",
                      rowDone[r]
                        ? "bg-transparent text-[var(--color-muted)]/50 line-through decoration-2"
                        : "bg-[var(--color-surface-2)] text-[var(--color-fg-soft)]",
                    )}
                    style={{
                      fontSize: clueFont,
                      padding: `${Math.max(2, clueFont * 0.28)}px ${Math.max(4, clueFont * 0.5)}px`,
                    }}
                  >
                    {clue.map((n, i) => (
                      <span key={i}>{n}</span>
                    ))}
                  </span>
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
                      showRight={c !== cols - 1}
                      showBottom={r !== rows - 1}
                      blockRight={(c + 1) % BLOCK_SIZE === 0 && c !== cols - 1}
                      blockBottom={(r + 1) % BLOCK_SIZE === 0 && r !== rows - 1}
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

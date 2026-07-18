import { type Page, expect } from "@playwright/test"

/**
 * Simulate a one-finger drag stroke across a sequence of "Cell r,c"-labelled
 * buttons via native TouchEvents (touchstart on the first, touchmove through
 * the rest, touchend on the last) — this is how the board's drag-to-paint
 * gesture is driven on touch devices.
 */
export async function dragAcrossCells(page: Page, labels: string[]) {
  const boxes = []
  for (const label of labels) {
    const box = await page.locator(`button[aria-label='${label}']`).boundingBox()
    if (!box) throw new Error(`No bounding box for ${label}`)
    boxes.push(box)
  }
  const dispatch = async (type: "touchstart" | "touchmove" | "touchend", x: number, y: number, sel: string) => {
    await page.evaluate(
      ([t, x, y, sel]) => {
        const el = document.querySelector(sel as string) as HTMLElement
        if (!el) throw new Error("missing")
        const touch = new Touch({
          identifier: 1,
          target: el,
          clientX: x as number,
          clientY: y as number,
          screenX: x as number,
          screenY: y as number,
          pageX: x as number,
          pageY: y as number,
          radiusX: 5,
          radiusY: 5,
          rotationAngle: 0,
          force: 1,
        })
        el.dispatchEvent(
          new TouchEvent(t as string, {
            bubbles: true,
            cancelable: true,
            touches: t === "touchend" ? [] : [touch],
            targetTouches: t === "touchend" ? [] : [touch],
            changedTouches: [touch],
          }),
        )
      },
      [type, x, y, sel],
    )
  }
  const cx = (b: { x: number; width: number }) => b.x + b.width / 2
  const cy = (b: { y: number; height: number }) => b.y + b.height / 2
  await dispatch("touchstart", cx(boxes[0]), cy(boxes[0]), `button[aria-label='${labels[0]}']`)
  for (let i = 1; i < boxes.length; i++) {
    await dispatch("touchmove", cx(boxes[i]), cy(boxes[i]), `button[aria-label='${labels[i]}']`)
    await page.waitForTimeout(30)
  }
  const last = boxes[boxes.length - 1]
  await dispatch("touchend", cx(last), cy(last), `button[aria-label='${labels[labels.length - 1]}']`)
  // Each cell is painted synchronously (via flushSync) as its touchmove is
  // dispatched above — no queued/staggered draining to wait out here.
}

export interface CellCounts {
  hidden: number
  marked: number
  filled: number
  total: number
}

/**
 * Pin Math.random so palette/modifier/solution generation are stable across
 * runs. Each Playwright test gets a fresh browser context with empty
 * localStorage, so we don't need to wipe it ourselves — and we shouldn't,
 * since `addInitScript` runs on every navigation (which would defeat
 * persistence tests that rely on state surviving a reload).
 */
export async function freshSession(page: Page) {
  await page.addInitScript(() => {
    let seed = 1
    Math.random = () => {
      seed = (seed * 9301 + 49297) % 233280
      return seed / 233280
    }
  })
}

export async function setPersisted(page: Page, kv: Record<string, unknown>) {
  await page.addInitScript((entries) => {
    for (const [k, v] of entries) {
      window.localStorage.setItem(k, JSON.stringify(v))
    }
  }, Object.entries(kv))
}

/**
 * Dismiss the "Ready" intro overlay if it's currently visible. Safe to call
 * even when the overlay isn't shown (no-op).
 */
export async function dismissIntro(page: Page) {
  const start = page.getByRole("button", { name: "Start", exact: true })
  if (await start.isVisible({ timeout: 500 }).catch(() => false)) {
    await start.click()
  }
}

export async function readBoard(page: Page) {
  return await page.evaluate(() => {
    const rows = []
    let r = 1
    while (true) {
      const row: { r: number; c: number; state: string }[] = []
      let c = 1
      while (true) {
        const b = document.querySelector(`button[aria-label='Cell ${r},${c}']`)
        if (!b) break
        const state = (b as HTMLElement).getAttribute("data-cell-state") ?? ""
        row.push({ r, c, state })
        c++
      }
      if (row.length === 0) break
      rows.push(row)
      r++
    }
    return rows
  })
}

export function summarize(board: Awaited<ReturnType<typeof readBoard>>): CellCounts {
  const out: CellCounts = { hidden: 0, marked: 0, filled: 0, total: 0 }
  for (const row of board) {
    for (const cell of row) {
      out.total++
      if (cell.state === "hidden") out.hidden++
      else if (cell.state === "marked") out.marked++
      else if (cell.state === "filled") out.filled++
    }
  }
  return out
}

/**
 * Wait for all CSS animations on `selector` (and its descendants) to finish.
 * Used after triggering enter/exit animations so geometry is measured at rest.
 */
export async function waitForAnimations(page: Page, selector = "[role=dialog]") {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel)
    if (!el) return false
    const anims = (el as Element).getAnimations({ subtree: true })
    return anims.length > 0 && anims.every((a) => a.playState === "finished")
  }, selector, { timeout: 2000 })
}

export async function expectNoOverflow(page: Page) {
  // Poll: ResizeObserver-driven layouts can take a couple of frames to settle
  // after a viewport change. Retry briefly before declaring overflow.
  await expect(async () => {
    const data = await page.evaluate(() => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const offenders: { tag: string; cls: string; w: number; h: number }[] = []
      const isInsideScrollContainer = (el: Element) => {
        let p: Element | null = el.parentElement
        while (p) {
          const cs = getComputedStyle(p)
          const isScrollable =
            cs.overflowY === "auto" ||
            cs.overflowY === "scroll" ||
            cs.overflowX === "auto" ||
            cs.overflowX === "scroll"
          const isPositionedClip =
            (cs.position === "fixed" || cs.position === "absolute" || cs.position === "sticky") &&
            (cs.overflowX === "hidden" || cs.overflowY === "hidden")
          if (isScrollable || isPositionedClip) return true
          p = p.parentElement
        }
        return false
      }
      for (const el of Array.from(document.querySelectorAll("*"))) {
        const r = el.getBoundingClientRect()
        if (r.right > vw + 1 || r.bottom > vh + 1) {
          if (isInsideScrollContainer(el)) continue
          offenders.push({
            tag: el.tagName.toLowerCase(),
            cls: ((el as HTMLElement).className?.toString?.() ?? "").slice(0, 80),
            w: Math.round(r.width),
            h: Math.round(r.height),
          })
        }
      }
      return {
        vw,
        vh,
        docW: document.documentElement.scrollWidth,
        docH: document.documentElement.scrollHeight,
        offenders,
      }
    })
    expect(data.offenders, `${data.offenders.length} elements overflow viewport`).toEqual([])
    expect(data.docW).toBeLessThanOrEqual(data.vw)
    expect(data.docH).toBeLessThanOrEqual(data.vh)
  }).toPass({ timeout: 2000 })
}

/** Cell shape used by localStorage-seeded boards in tests. */
export interface SeedCell {
  solution: boolean
  state: "hidden" | "filled" | "marked"
  bonus?: boolean
  mirror?: boolean
  item?: string | null
}

export function makeSeedBoard(
  rows: number,
  cols: number,
  fn: (r: number, c: number) => Partial<SeedCell>,
): SeedCell[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => ({
      solution: false,
      state: "hidden" as const,
      bonus: false,
      mirror: false,
      item: null,
      ...fn(r, c),
    })),
  )
}

/** Build a full ng.activeRound payload ready for JSON.stringify + localStorage.setItem. */
export function makeActiveRound(opts: {
  level?: number
  rows: number
  cols: number
  fillTarget: number
  bonusCells?: number
  mistakeLimit?: number
  mistakesUsed?: number
  modifierId?: string
  paletteSeed?: number
  board: SeedCell[][]
  status: "ready" | "playing" | "won" | "lost"
  seconds?: number
  wrongFlash?: [number, number] | null
  countdown?: number | null
  bonusValue?: number
  lossReason?: "mistakes" | "time" | null
}) {
  return {
    schemaVersion: 1,
    level: opts.level ?? 1,
    rows: opts.rows,
    cols: opts.cols,
    fillTarget: opts.fillTarget,
    bonusCells: opts.bonusCells ?? 0,
    mistakeLimit: opts.mistakeLimit ?? 3,
    mistakesUsed: opts.mistakesUsed ?? 0,
    modifierId: opts.modifierId ?? "calm",
    paletteSeed: opts.paletteSeed ?? 0,
    board: opts.board,
    status: opts.status,
    seconds: opts.seconds ?? 0,
    wrongFlash: opts.wrongFlash ?? null,
    countdown: opts.countdown ?? null,
    bonusValue: opts.bonusValue ?? 5,
    lossReason: opts.lossReason ?? null,
  }
}

/**
 * Seed `ng.activeRound` and load the app with it — for tests that need to
 * `page.reload()` afterwards. Unlike `page.addInitScript`, this writes the
 * seed exactly once (via `page.evaluate` after an initial throwaway load)
 * instead of re-injecting it on every navigation, so a later reload picks up
 * whatever the live app has since persisted rather than being stomped back
 * to the original seed.
 */
export async function seedActiveRound(page: Page, round: unknown) {
  await page.goto("/")
  await page.evaluate((r) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(r))
  }, round)
  await page.reload()
}

import { test, expect } from "@playwright/test"
import {
  dismissIntro,
  freshSession,
  makeActiveRound,
  makeSeedBoard,
  readBoard,
  summarize,
} from "./_helpers"

test.beforeEach(async ({ page }) => {
  await freshSession(page)
})

// Diagonal 3×3 solution: (0,0), (1,1), (2,2) filled. Row/col clues all [1].
function diagonalBoard() {
  return makeSeedBoard(3, 3, (r, c) => ({ solution: r === c }))
}

test("tapping a hidden cell starts the timer", async ({ page }) => {
  await page.goto("/")
  await dismissIntro(page)
  const before = summarize(await readBoard(page))
  expect(before.hidden).toBe(before.total)

  await page.getByLabel("Cell 3,3").click()
  await page.waitForTimeout(1200)
  const playbarText = await page.locator("body").innerText()
  expect(playbarText).not.toMatch(/\b00:00\b/)
})

test("filling every solution cell wins the round", async ({ page }) => {
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
  }, makeActiveRound({ rows: 3, cols: 3, fillTarget: 3, board: diagonalBoard(), status: "playing" }))
  await page.goto("/")

  await page.getByLabel("Cell 1,1").click()
  await page.getByLabel("Cell 2,2").click()
  await expect(page.getByText("Level complete")).toHaveCount(0)
  await page.getByLabel("Cell 3,3").click()
  await expect(page.getByText("Level complete")).toBeVisible({ timeout: 2000 })
})

test("filling a wrong cell flashes red, reverts to hidden, and costs a mistake", async ({ page }) => {
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
  }, makeActiveRound({
    rows: 3, cols: 3, fillTarget: 3, mistakeLimit: 3, board: diagonalBoard(), status: "playing",
  }))
  await page.goto("/")

  // Cell 1,2 (row 0, col 1) is NOT part of the diagonal solution.
  await page.getByLabel("Cell 1,2").click()
  await expect(page.getByLabel("Cell 1,2")).toHaveAttribute("data-cell-state", "hidden")
  await expect(page.getByLabel("3 mistakes remaining")).toHaveCount(0)
  await expect(page.getByLabel("2 mistakes remaining")).toBeVisible()
})

test("long-press marks a cell — independent of mark-mode", async ({ page }) => {
  await page.goto("/")
  await dismissIntro(page)

  async function longPress(label: string) {
    const cell = page.locator(`button[aria-label='${label}']`)
    const box = await cell.boundingBox()
    if (!box) throw new Error(`No bounding box for ${label}`)
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const dispatch = async (type: "touchstart" | "touchend") => {
      await page.evaluate(
        ([sel, x, y, t]) => {
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
        [`button[aria-label='${label}']`, cx, cy, type],
      )
    }
    await dispatch("touchstart")
    await page.waitForTimeout(360) // > LONG_PRESS_MS
    await dispatch("touchend")
  }

  await longPress("Cell 1,1")
  await expect(page.getByLabel("Cell 1,1")).toHaveAttribute("data-cell-state", "marked")

  await page.getByLabel("Switch to mark mode").click()
  await longPress("Cell 1,3")
  await expect(page.getByLabel("Cell 1,3")).toHaveAttribute("data-cell-state", "marked")
})

test("mark-mode toggle inverts tap behaviour", async ({ page }) => {
  await page.goto("/")
  await dismissIntro(page)
  await page.getByLabel("Switch to mark mode").click()
  await page.getByLabel("Cell 1,1").click()
  await expect(page.getByLabel("Cell 1,1")).toHaveAttribute("data-cell-state", "marked")
  const after = summarize(await readBoard(page))
  expect(after.marked).toBe(1)
})

test("completing a line's clue auto-crosses out its remaining hidden cells", async ({ page }) => {
  // Row 0 solution: [true, false, true] → clue [1,1]. Rows 1-2 are all-empty.
  const board = makeSeedBoard(3, 3, (r) => ({ solution: r === 0 }))
  board[0][1].solution = false
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
  }, makeActiveRound({ rows: 3, cols: 3, fillTarget: 2, board, status: "playing" }))
  await page.goto("/")

  await page.getByLabel("Cell 1,1").click()
  await expect(page.getByLabel("Cell 1,2")).toHaveAttribute("data-cell-state", "hidden")
  await page.getByLabel("Cell 1,3").click()
  // Row 0's clue [1,1] is now satisfied by the two filled cells — the
  // remaining hidden cell in that row auto-crosses out.
  await expect(page.getByLabel("Cell 1,2")).toHaveAttribute("data-cell-state", "marked")
})

test("Mirror modifier fills the symmetric cell for free", async ({ page }) => {
  // Row 0 solution: [true, false, true] — a mirrored pair around the centre.
  const board = makeSeedBoard(3, 3, () => ({ solution: false }))
  board[0][0].solution = true
  board[0][2].solution = true
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
  }, makeActiveRound({
    rows: 3, cols: 3, fillTarget: 2, modifierId: "mirror", board, status: "playing",
  }))
  await page.goto("/")

  await page.getByLabel("Cell 1,1").click()
  await expect(page.getByLabel("Cell 1,1")).toHaveAttribute("data-cell-state", "filled")
  await expect(page.getByLabel("Cell 1,3")).toHaveAttribute("data-cell-state", "filled")
})

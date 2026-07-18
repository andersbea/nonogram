import { test, expect } from "@playwright/test"
import { dragAcrossCells, freshSession, makeActiveRound, makeSeedBoard } from "./_helpers"

// Diagonal 3×3 solution with (0,0) and (1,1) already correctly filled — only
// (2,2) remains hidden. Clicking it should trigger the win.
function almostWonBoard() {
  return makeSeedBoard(3, 3, (r, c) => {
    const solution = r === c
    if (!solution) return { solution: false }
    return { solution: true, state: r < 2 ? ("filled" as const) : ("hidden" as const) }
  })
}

test.beforeEach(async ({ page }) => {
  await freshSession(page)
})

// ─── Win overlay ───────────────────────────────────────────────────────────────

test("win overlay shows 'Level complete' when the last cell is filled", async ({ page }) => {
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
  }, makeActiveRound({ level: 3, rows: 3, cols: 3, fillTarget: 3, board: almostWonBoard(), status: "playing" }))
  await page.goto("/")
  await page.getByLabel("Cell 3,3").click()
  await expect(page.getByText("Level complete")).toBeVisible({ timeout: 2000 })
  await expect(page.getByRole("button", { name: /Next level/ })).toBeVisible()
})

// ─── Level advancement ─────────────────────────────────────────────────────────

test("Next level button advances the level counter by one", async ({ page }) => {
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
  }, makeActiveRound({ level: 5, rows: 3, cols: 3, fillTarget: 3, board: almostWonBoard(), status: "playing" }))
  await page.goto("/")
  await page.getByLabel("Cell 3,3").click()
  await expect(page.getByText("Level complete")).toBeVisible({ timeout: 2000 })
  await page.getByRole("button", { name: /Next level/ }).click()
  await expect(page.getByText(/Level 6/)).toBeVisible({ timeout: 2000 })
})

// ─── Countdown expiry ──────────────────────────────────────────────────────────

test("countdown expiry shows 'Time's up' overlay", async ({ page }) => {
  // At least one solution cell must stay unfilled, otherwise checkWin() is
  // vacuously true and the countdown-expired handler bails out early.
  const board = makeSeedBoard(3, 3, () => ({ solution: false }))
  board[0][0].solution = true
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
  }, makeActiveRound({
    rows: 3, cols: 3, fillTarget: 1, modifierId: "quick",
    board,
    status: "playing", seconds: 1, countdown: 30,
  }))
  await page.goto("/")
  // Timer fires almost immediately (≤1 s to reach 0) then the 1.8 s delay
  // kicks in before the overlay appears. Give it 5 s total to be safe.
  await expect(page.getByText("Time's up")).toBeVisible({ timeout: 5000 })
  await expect(page.getByRole("button", { name: /Retry level/ })).toBeVisible()
})

test("countdown expiry reveals the remaining answer but leaves marks alone", async ({ page }) => {
  // (0,0) is part of the solution and still hidden; (1,1) is marked but is
  // NOT part of the solution — the debrief should only touch (0,0).
  const board = makeSeedBoard(3, 3, () => ({ solution: false }))
  board[0][0].solution = true
  board[1][1].state = "marked"
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
  }, makeActiveRound({
    rows: 3, cols: 3, fillTarget: 1, modifierId: "quick", board,
    status: "playing", seconds: 1, countdown: 30,
  }))
  await page.goto("/")
  await page.waitForTimeout(1500)

  await expect(page.locator("button[aria-label='Cell 1,1']")).toHaveAttribute(
    "data-cell-state", "filled",
  )
  await expect(page.locator("button[aria-label='Cell 2,2']")).toHaveAttribute(
    "data-cell-state", "marked",
  )
  await expect(page.getByText("Time's up")).toBeVisible({ timeout: 5000 })
})

// ─── Second Chance ──────────────────────────────────────────────────────────────

test("Second Chance auto-cancels a wrong fill instead of charging a mistake", async ({ page }) => {
  const board = makeSeedBoard(3, 3, (r, c) => ({ solution: r === c }))
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
    window.localStorage.setItem("ng.items", JSON.stringify(["undo"]))
    window.localStorage.setItem("ng.itemLocks", JSON.stringify([false]))
  }, makeActiveRound({ rows: 3, cols: 3, fillTarget: 3, mistakeLimit: 3, board, status: "playing" }))
  await page.goto("/")

  // Cell 1,2 is not part of the diagonal solution.
  await page.getByLabel("Cell 1,2").click()
  await expect(page.getByRole("status")).toContainText("Second Chance", { timeout: 2000 })
  // No mistake was charged — the counter is still at its starting value.
  await expect(page.getByLabel("3 mistakes remaining")).toBeVisible()

  const items = await page.evaluate(() => JSON.parse(window.localStorage.getItem("ng.items") ?? "[]"))
  expect(items).not.toContain("undo")
})

test("Second Chance also auto-cancels a wrong fill hit mid-drag stroke", async ({ page }) => {
  // Row 0 solution: [true, false, false, true] — clue [1,1]. Filling just
  // Cell 1,1 doesn't satisfy that clue on its own (it needs both runs), so
  // the rest of the row stays genuinely hidden instead of being
  // auto-crossed-out — which would happen instantly if the row's clue
  // were just [1], stepping on this test before the drag even gets there.
  const board = makeSeedBoard(4, 4, () => ({ solution: false }))
  board[0][0].solution = true
  board[0][3].solution = true
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
    window.localStorage.setItem("ng.items", JSON.stringify(["undo"]))
    window.localStorage.setItem("ng.itemLocks", JSON.stringify([false]))
  }, makeActiveRound({ rows: 4, cols: 4, fillTarget: 2, mistakeLimit: 3, board, status: "playing" }))
  await page.goto("/")

  await dragAcrossCells(page, ["Cell 1,1", "Cell 1,2", "Cell 1,3"])

  await expect(page.getByLabel("Cell 1,1")).toHaveAttribute("data-cell-state", "filled")
  await expect(page.getByRole("status")).toContainText("Second Chance", { timeout: 2000 })
  // No mistake was charged for the wrong cell the stroke landed on, and the
  // absorbed wrong fill still reverts to hidden like any wrong fill would.
  await expect(page.getByLabel("3 mistakes remaining")).toBeVisible()
  await expect(page.getByLabel("Cell 1,2")).toHaveAttribute("data-cell-state", "hidden")
  // The stroke still halted at the wrong cell — Cell 1,3 was never reached.
  await expect(page.getByLabel("Cell 1,3")).toHaveAttribute("data-cell-state", "hidden")

  const items = await page.evaluate(() => JSON.parse(window.localStorage.getItem("ng.items") ?? "[]"))
  expect(items).not.toContain("undo")
})

// ─── Mistake limit ──────────────────────────────────────────────────────────────

test("running out of mistakes ends the round", async ({ page }) => {
  const board = makeSeedBoard(3, 3, (r, c) => ({ solution: r === c }))
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
  }, makeActiveRound({ rows: 3, cols: 3, fillTarget: 3, mistakeLimit: 1, board, status: "playing" }))
  await page.goto("/")

  // Two wrong cells: (0,1) and (0,2) are both off the diagonal.
  await page.getByLabel("Cell 1,2").click()
  await expect(page.getByText("Out of chances")).toHaveCount(0)
  await page.getByLabel("Cell 1,3").click()
  await expect(page.getByText("Out of chances")).toBeVisible({ timeout: 3500 })
})

test("Precision modifier: a single wrong fill ends the round instantly", async ({ page }) => {
  const board = makeSeedBoard(3, 3, (r, c) => ({ solution: r === c }))
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
  }, makeActiveRound({
    rows: 3, cols: 3, fillTarget: 3, mistakeLimit: 0, modifierId: "precision",
    board, status: "playing",
  }))
  await page.goto("/")
  await page.getByLabel("Cell 1,2").click()
  await expect(page.getByText("Out of chances")).toBeVisible({ timeout: 3500 })
})

// ─── Retry inventory restoration ───────────────────────────────────────────────

test("Retry level restores inventory from the round-start snapshot", async ({ page }) => {
  const board = makeSeedBoard(3, 3, (r, c) => ({ solution: r === c }))
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
    // Current inventory was depleted during the round (only "scan" remains).
    window.localStorage.setItem("ng.items", JSON.stringify(["scan"]))
    window.localStorage.setItem("ng.itemLocks", JSON.stringify([false]))
    // The round-start snapshot had both items.
    window.localStorage.setItem("ng.roundStartItems", JSON.stringify(["pick", "scan"]))
    window.localStorage.setItem("ng.roundStartItemLocks", JSON.stringify([false, false]))
  }, makeActiveRound({
    level: 2, rows: 3, cols: 3, fillTarget: 3, mistakeLimit: 1, mistakesUsed: 2,
    board, status: "lost", lossReason: "mistakes",
  }))
  await page.goto("/")

  await expect(page.getByText("Out of chances")).toBeVisible({ timeout: 4000 })
  await page.getByRole("button", { name: /Retry level/ }).click()

  const items = await page.evaluate(() => JSON.parse(window.localStorage.getItem("ng.items") ?? "[]"))
  expect(items).toEqual(["pick", "scan"])
})

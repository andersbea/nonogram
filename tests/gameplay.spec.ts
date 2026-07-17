import { test, expect } from "@playwright/test"
import {
  dismissIntro,
  dragAcrossCells,
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

test("dragging a finger across cells in mark mode marks all of them in one stroke", async ({ page }) => {
  // None of row 0's cells are part of the solution, so the drag-halt-on-
  // solution-cell behaviour (tested separately below) never kicks in here.
  const board = makeSeedBoard(4, 4, (r) => ({ solution: r === 3 }))
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
  }, makeActiveRound({ rows: 4, cols: 4, fillTarget: 4, board, status: "playing" }))
  await page.goto("/")
  await page.getByLabel("Switch to mark mode").click()

  await dragAcrossCells(page, ["Cell 1,1", "Cell 1,2", "Cell 1,3", "Cell 1,4"])
  for (const label of ["Cell 1,1", "Cell 1,2", "Cell 1,3", "Cell 1,4"]) {
    await expect(page.getByLabel(label)).toHaveAttribute("data-cell-state", "marked")
  }
})

test("dragging in mark mode halts the stroke at the first cell that's actually part of the solution", async ({ page }) => {
  // Row 0 solution: [false, false, true, false] — board[0][2] (Cell 1,3) is
  // a real solution cell hiding in the middle of the drag path.
  const board = makeSeedBoard(4, 4, () => ({ solution: false }))
  board[0][2].solution = true
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
  }, makeActiveRound({ rows: 4, cols: 4, fillTarget: 1, board, status: "playing" }))
  await page.goto("/")
  await page.getByLabel("Switch to mark mode").click()

  await dragAcrossCells(page, ["Cell 1,1", "Cell 1,2", "Cell 1,3", "Cell 1,4"])

  await expect(page.getByLabel("Cell 1,1")).toHaveAttribute("data-cell-state", "marked")
  await expect(page.getByLabel("Cell 1,2")).toHaveAttribute("data-cell-state", "marked")
  // The offending cell itself still gets marked (visible feedback that it
  // happened) ...
  await expect(page.getByLabel("Cell 1,3")).toHaveAttribute("data-cell-state", "marked")
  // ...but nothing further along the same stroke does.
  await expect(page.getByLabel("Cell 1,4")).toHaveAttribute("data-cell-state", "hidden")
})

test("a fresh swipe over an already-marked solution cell doesn't halt — it's a no-op, not a new mistake", async ({ page }) => {
  // Same layout as above, but Cell 1,3 is already marked from an earlier
  // stroke by the time this drag runs. Re-swiping across it shouldn't
  // change anything about it — nor should it stop the new stroke from
  // reaching cells further along the row.
  const board = makeSeedBoard(4, 4, () => ({ solution: false }))
  board[0][2].solution = true
  board[0][2].state = "marked"
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
  }, makeActiveRound({ rows: 4, cols: 4, fillTarget: 1, board, status: "playing" }))
  await page.goto("/")
  await page.getByLabel("Switch to mark mode").click()

  await dragAcrossCells(page, ["Cell 1,1", "Cell 1,2", "Cell 1,3", "Cell 1,4"])

  for (const label of ["Cell 1,1", "Cell 1,2", "Cell 1,3", "Cell 1,4"]) {
    await expect(page.getByLabel(label)).toHaveAttribute("data-cell-state", "marked")
  }
})

test("tapping a cell (no movement) marks only that one cell — no special hold behaviour", async ({ page }) => {
  await page.goto("/")
  await dismissIntro(page)
  await page.getByLabel("Switch to mark mode").click()

  // A tap — press and release with no movement — should mark only the one
  // cell it landed on, whether the press was brief or held a while.
  const cell = page.getByLabel("Cell 2,2")
  await cell.click({ delay: 500 })
  await expect(cell).toHaveAttribute("data-cell-state", "marked")
  await expect(page.getByLabel("Cell 2,1")).toHaveAttribute("data-cell-state", "hidden")
  await expect(page.getByLabel("Cell 2,3")).toHaveAttribute("data-cell-state", "hidden")
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

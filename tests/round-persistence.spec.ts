import { test, expect } from "@playwright/test"
import {
  freshSession,
  makeActiveRound,
  makeSeedBoard,
  readBoard,
  seedActiveRound,
  summarize,
  waitForAnimations,
} from "./_helpers"

test.beforeEach(async ({ page }) => {
  await freshSession(page)
})

function diagonalBoard() {
  return makeSeedBoard(3, 3, (r, c) => ({ solution: r === c }))
}

// 5×5 board where the top-left 2 cells of both row 0 and col 0 must be
// filled together (clue [2] each) — so filling just (0,0) alone doesn't
// satisfy either line's clue and trigger the auto-mark cascade tested
// elsewhere. Keeps this persistence test's cell counts fully deterministic.
function nonCascadingBoard() {
  const board = makeSeedBoard(5, 5, () => ({ solution: false }))
  board[0][0].solution = true
  board[0][1].solution = true
  board[1][0].solution = true
  return board
}

test("mid-round board state survives a refresh", async ({ page }) => {
  await seedActiveRound(page, makeActiveRound({
    rows: 5, cols: 5, fillTarget: 3, modifierId: "calm", board: nonCascadingBoard(), status: "playing",
  }))

  // Fill a correct cell, mark an unrelated one.
  await page.getByLabel("Cell 1,1").click()
  await page.getByLabel("Cell 5,5").click({ button: "right" })
  await page.waitForTimeout(1100) // let the timer tick at least once
  const beforeBoard = summarize(await readBoard(page))
  expect(beforeBoard.filled).toBe(1)
  expect(beforeBoard.marked).toBe(1)

  const before = await page.evaluate(() => document.body.innerText)

  await page.reload()

  const afterBoard = summarize(await readBoard(page))
  expect(afterBoard).toEqual(beforeBoard)
  const after = await page.evaluate(() => document.body.innerText)
  const modifierBefore = before.match(/(Calm|Quick Round|Bonus Cells|Dense Field|Big Board|Mirror|Precision)/)?.[0]
  const modifierAfter = after.match(/(Calm|Quick Round|Bonus Cells|Dense Field|Big Board|Mirror|Precision)/)?.[0]
  expect(modifierAfter).toBe(modifierBefore)
})

test("timer value survives a refresh and keeps ticking", async ({ page }) => {
  async function readSec() {
    return await page.evaluate(() => {
      const m = document.body.innerText.match(/\b(\d{2}):(\d{2})\b/)
      return m ? Number(m[1]) * 60 + Number(m[2]) : -1
    })
  }
  await seedActiveRound(page, makeActiveRound({ rows: 3, cols: 3, fillTarget: 3, board: diagonalBoard(), status: "playing" }))
  await page.waitForTimeout(2200)
  const before = await readSec()
  expect(before).toBeGreaterThanOrEqual(2)

  await page.reload()
  const justAfter = await readSec()
  expect(justAfter, "timer should pick up at or near the saved value").toBeGreaterThanOrEqual(before)
  await page.waitForTimeout(1200)
  const later = await readSec()
  expect(later, "timer should keep ticking after reload").toBeGreaterThan(justAfter)
})

test("a lost round still shows the loss overlay after refresh", async ({ page }) => {
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
  }, makeActiveRound({
    rows: 3, cols: 3, fillTarget: 3, mistakeLimit: 1, mistakesUsed: 2,
    board: diagonalBoard(), status: "lost", lossReason: "mistakes",
  }))
  await page.goto("/")
  // The 1.8s post-loss delay re-runs on mount even for an already-lost save.
  await expect(page.getByText("Out of chances")).toBeVisible({ timeout: 3500 })
  await expect(page.getByRole("button", { name: /Retry level/ })).toBeVisible()
})

test("New run wipes the saved round so the next reload starts fresh", async ({ page }) => {
  await seedActiveRound(page, makeActiveRound({ rows: 3, cols: 3, fillTarget: 3, board: diagonalBoard(), status: "playing" }))

  await page.getByLabel("Cell 1,1").click()
  const dirty = summarize(await readBoard(page))
  expect(dirty.filled).toBeGreaterThan(0)

  await page.getByLabel("Open menu").click()
  await waitForAnimations(page)
  await page.getByRole("button", { name: "New run" }).click()

  await page.reload()
  const fresh = summarize(await readBoard(page))
  expect(fresh.filled).toBe(0)
  expect(fresh.marked).toBe(0)
})

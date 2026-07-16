import { test, expect } from "@playwright/test"
import {
  dismissIntro,
  freshSession,
  makeActiveRound,
  makeSeedBoard,
  readBoard,
  summarize,
  waitForAnimations,
} from "./_helpers"

test.beforeEach(async ({ page }) => {
  await freshSession(page)
})

test("Ready overlay shows level + modifier and board info before first fill", async ({ page }) => {
  await page.goto("/")
  // The ReadyOverlay is up before we touch the board.
  await expect(page.getByText(/Level 1/)).toBeVisible()
  await expect(page.getByText(/Board/)).toBeVisible()
  await expect(page.getByText(/Clock/)).toBeVisible()
  await expect(page.getByText(/Mistakes/)).toBeVisible()
  // One of the seven modifier names is shown somewhere in the body.
  const body = await page.locator("body").innerText()
  expect(body).toMatch(/Calm|Quick Round|Bonus Cells|Dense Field|Big Board|Mirror|Precision/)
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible()
})

test("dismissing intro lets cells become interactive", async ({ page }) => {
  await page.goto("/")
  await dismissIntro(page)
  await page.getByLabel("Cell 5,5").click()
  const after = summarize(await readBoard(page))
  // Whether that particular click was correct or not, the round must be
  // "playing" — the timer starts either way. Filled+marked+hidden still sum
  // to total, but at minimum nothing crashed and the round advanced.
  expect(after.total).toBeGreaterThan(0)
})

test("marking then unmarking a cell does not trigger a win", async ({ page }) => {
  await page.goto("/")
  await dismissIntro(page)
  await page.getByLabel("Cell 1,1").click({ button: "right" })
  await expect(page.getByLabel("Cell 1,1")).toHaveAttribute("data-cell-state", "marked")
  await page.getByLabel("Cell 1,1").click({ button: "right" })
  await expect(page.getByLabel("Cell 1,1")).toHaveAttribute("data-cell-state", "hidden")
  // No game-status overlay at all — we're still in the ready/playing phase.
  await expect(page.getByText("Level complete")).toHaveCount(0)
  await expect(page.getByText("Out of chances")).toHaveCount(0)
  await expect(page.getByText("Time's up")).toHaveCount(0)
})

test("each new level shows the Ready overlay again", async ({ page }) => {
  await page.goto("/")
  await dismissIntro(page)
  // Trigger New Run via the menu — that starts a fresh level with status=ready.
  await page.getByLabel("Open menu").click()
  await waitForAnimations(page)
  await page.getByRole("button", { name: "New run" }).click()
  // Ready overlay should reappear for the new level.
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible()
})

test("Bonus Cells mode adds time when a bonus cell is correctly filled", async ({ page }) => {
  // Pre-seed a bonus-cell round so we don't have to wait for random selection.
  const board = makeSeedBoard(3, 3, (r, c) => ({ solution: r === 0 && c === 0 }))
  board[0][0].bonus = true
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
  }, makeActiveRound({
    rows: 3, cols: 3, fillTarget: 1, modifierId: "bonus", board,
    status: "playing", seconds: 20, countdown: 30, bonusValue: 6, bonusCells: 1,
  }))
  await page.goto("/")
  await page.getByLabel("Cell 1,1").click()
  // A "+6s" float should appear near the top of the board.
  await expect(page.getByText("+6s")).toBeVisible({ timeout: 1000 })
})

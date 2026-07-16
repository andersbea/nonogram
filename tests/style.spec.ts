import { test, expect } from "@playwright/test"
import { dismissIntro, freshSession, makeActiveRound, makeSeedBoard, waitForAnimations } from "./_helpers"

test.beforeEach(async ({ page }) => {
  await freshSession(page)
})

test("level badge and modifier name appear in the playbar", async ({ page }) => {
  await page.goto("/")
  await dismissIntro(page)
  // The badge text format is two-digit, e.g. "01".
  const badge = page.getByLabel(/Level \d+/)
  await expect(badge).toBeVisible()
  await expect(badge).toHaveText(/^\d{2}$/)
  // Modifier name lives next to the badge.
  await expect(
    page.locator("text=/Calm|Quick Round|Bonus Cells|Dense Field|Big Board|Mirror|Precision/").first(),
  ).toBeVisible()
})

test("playbar level badge has a gradient background", async ({ page }) => {
  await page.goto("/")
  await dismissIntro(page)
  const bg = await page.getByLabel(/Level \d+/).evaluate((el) => getComputedStyle(el).background)
  // Tailwind compiles the inline `linear-gradient(...)` into the background
  // shorthand. We only need to confirm a gradient is actually applied.
  expect(bg).toMatch(/linear-gradient/)
  expect(bg).toMatch(/oklch/)
})

test("a completed line's clue is dimmed with a strikethrough", async ({ page }) => {
  // Row 0 solution: [true, false, true] → clue [1,1].
  const board = makeSeedBoard(3, 3, (r) => ({ solution: r === 0 }))
  board[0][1].solution = false
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
  }, makeActiveRound({ rows: 3, cols: 3, fillTarget: 2, board, status: "playing" }))
  await page.goto("/")

  await page.getByLabel("Cell 1,1").click()
  await page.getByLabel("Cell 1,3").click()
  // Row 0's clue header should now render with the "done" (line-through) style.
  const doneHeaders = await page.locator(".line-through").count()
  expect(doneHeaders).toBeGreaterThan(0)
})

test("menu sheet anchors at the bottom and is horizontally centred", async ({ page }) => {
  await page.goto("/")
  await dismissIntro(page)
  await page.getByLabel("Open menu").click()
  const dialog = page.getByRole("dialog", { name: "Game menu" })
  await expect(dialog).toBeVisible()
  await waitForAnimations(page)
  const data = await page.evaluate(() => {
    const d = document.querySelector("[role=dialog]") as HTMLElement
    const r = d.getBoundingClientRect()
    return {
      bottom: r.bottom,
      width: r.width,
      vw: window.innerWidth,
      vh: window.innerHeight,
      left: r.left,
      right: r.right,
    }
  })
  // Bottom edge sits flush at the viewport bottom.
  expect(Math.abs(data.bottom - data.vh)).toBeLessThan(2)
  // Horizontally centred (within 1px tolerance).
  expect(Math.abs(data.left - (data.vw - data.right))).toBeLessThan(2)
})

test("menu sheet unmounts when closed (no offscreen DOM)", async ({ page }) => {
  await page.goto("/")
  await dismissIntro(page)
  // Closed by default → dialog should not exist.
  await expect(page.getByRole("dialog", { name: "Game menu" })).toHaveCount(0)
  await page.getByLabel("Open menu").click()
  await expect(page.getByRole("dialog", { name: "Game menu" })).toBeVisible()
  await page.getByLabel("Close menu").click()
  // Wait past the 320ms unmount delay.
  await page.waitForTimeout(450)
  await expect(page.getByRole("dialog", { name: "Game menu" })).toHaveCount(0)
})

test("mark-mode toggle changes its computed appearance", async ({ page }) => {
  await page.goto("/")
  await dismissIntro(page)
  const off = await page
    .getByLabel("Switch to mark mode")
    .evaluate((el) => getComputedStyle(el).borderColor)
  await page.getByLabel("Switch to mark mode").click()
  const on = await page
    .getByLabel("Switch to fill mode")
    .evaluate((el) => getComputedStyle(el).borderColor)
  expect(on).not.toBe(off)
})

test("background blobs carry a radial-gradient tied to the active modifier", async ({ page }) => {
  await page.goto("/")
  await dismissIntro(page)
  // Gradient blobs are rendered as .bg-blob-a / .bg-blob-b fixed divs in
  // App.tsx; their colour is driven by --gradient-a/b set per modifier.
  const bg = await page.evaluate(
    () => getComputedStyle(document.querySelector(".bg-blob-a")!).backgroundImage,
  )
  expect(bg).toMatch(/radial-gradient/)
  // Should be a non-trivial computed value (the color-mix resolves to rgba…)
  expect(bg.length).toBeGreaterThan(50)
})

test("desktop and mobile both render exactly one playbar above the board", async ({ page }) => {
  await page.goto("/")
  await dismissIntro(page)
  // A board grid exists.
  const cellCount = await page.locator("button[aria-label^='Cell ']").count()
  expect(cellCount).toBeGreaterThanOrEqual(25) // at least 5×5
  // Exactly one menu open button visible (i.e. one PlayBar).
  await expect(page.getByLabel("Open menu")).toHaveCount(1)
})

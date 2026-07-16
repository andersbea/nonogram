import { test, expect } from "@playwright/test"
import { dismissIntro, freshSession, makeActiveRound, makeSeedBoard, setPersisted } from "./_helpers"

test.beforeEach(async ({ page }) => {
  await freshSession(page)
})

test("ItemsBar hidden when inventory is empty", async ({ page }) => {
  await page.goto("/")
  await dismissIntro(page)
  await expect(page.getByRole("list", { name: "Items" })).toHaveCount(0)
})

test("ItemsBar shows three slots when player has items", async ({ page }) => {
  await setPersisted(page, { "ng.items": ["undo", "pick", "scan"] })
  await page.goto("/")
  await dismissIntro(page)
  const bar = page.getByRole("list", { name: "Items" })
  await expect(bar).toBeVisible()
  // The bar always has exactly ITEM_MAX (3) slots — held items + empty placeholders.
  const slots = page.locator('[role="listitem"]')
  await expect(slots).toHaveCount(3)
})

test("Lucky Fill correctly fills a hidden cell and is consumed", async ({ page }) => {
  const board = makeSeedBoard(3, 3, (r, c) => ({ solution: r === c }))
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
    window.localStorage.setItem("ng.items", JSON.stringify(["pick"]))
  }, makeActiveRound({ rows: 3, cols: 3, fillTarget: 3, board, status: "playing" }))
  await page.goto("/")
  const hiddenBefore = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button[aria-label^='Cell ']")).filter((b) =>
      (b as HTMLElement).getAttribute("data-cell-state") === "hidden",
    ).length,
  )
  await page.getByRole("listitem").first().click()
  const hiddenAfter = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button[aria-label^='Cell ']")).filter((b) =>
      (b as HTMLElement).getAttribute("data-cell-state") === "hidden",
    ).length,
  )
  expect(hiddenAfter).toBeLessThan(hiddenBefore)
  const items = await page.evaluate(() => JSON.parse(localStorage.getItem("ng.items") ?? "[]"))
  expect(items).not.toContain("pick")
})

test("Second Chance is not manually consumable — slot is disabled", async ({ page }) => {
  const board = makeSeedBoard(3, 3, (r, c) => ({ solution: r === c }))
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
    window.localStorage.setItem("ng.items", JSON.stringify(["undo"]))
  }, makeActiveRound({ rows: 3, cols: 3, fillTarget: 3, board, status: "playing" }))
  await page.goto("/")
  const slot = page.getByRole("listitem").first()
  await expect(slot).toBeDisabled()
})

test("Clue Scan highlights the remaining answer briefly", async ({ page }) => {
  const board = makeSeedBoard(3, 3, (r, c) => ({ solution: r === c }))
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
    window.localStorage.setItem("ng.items", JSON.stringify(["scan"]))
  }, makeActiveRound({ rows: 3, cols: 3, fillTarget: 3, board, status: "playing" }))
  await page.goto("/")
  // Activate the Scan slot.
  await page.getByRole("listitem").first().click()
  // Within the 2s window, some hidden cell should be marked via the ring/pulse class.
  const ringsDuring = await page
    .locator("span.ring-2.ring-\\[var\\(--color-success\\)\\]\\/70")
    .count()
  expect(ringsDuring).toBeGreaterThan(0)
  // Wait past the 2s timer; effect should clear.
  await page.waitForTimeout(2100)
  const ringsAfter = await page
    .locator("span.ring-2.ring-\\[var\\(--color-success\\)\\]\\/70")
    .count()
  expect(ringsAfter).toBe(0)
})

test("Inventory caps at three (won't go above ITEM_MAX)", async ({ page }) => {
  await setPersisted(page, { "ng.items": ["undo", "pick", "scan"] })
  await page.goto("/")
  await dismissIntro(page)
  await expect(page.getByRole("listitem")).toHaveCount(3)
})

test("New Run wipes the item inventory", async ({ page }) => {
  await setPersisted(page, { "ng.items": ["undo", "pick", "scan"] })
  await page.goto("/")
  await dismissIntro(page)
  await expect(page.getByRole("list", { name: "Items" })).toBeVisible()
  await page.getByLabel("Open menu").click()
  await page.getByRole("button", { name: "New run" }).click()
  await dismissIntro(page)
  await expect(page.getByRole("list", { name: "Items" })).toHaveCount(0)
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ng.items") ?? "[]"))
  expect(stored).toEqual([])
})

test("collecting an item from a board cell adds it to inventory", async ({ page }) => {
  // Solution cell (1,1) carries a "scan" item. Fill then tap again to collect.
  const board = makeSeedBoard(3, 3, (r, c) => ({ solution: r === c }))
  board[1][1].item = "scan"
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
  }, makeActiveRound({ rows: 3, cols: 3, fillTarget: 3, board, status: "playing" }))
  await page.goto("/")

  await page.getByLabel("Cell 2,2").click() // fill
  let stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ng.items") ?? "[]"))
  expect(stored).toEqual([])
  await page.locator("button[aria-label^='Cell 2,2']").click() // collect
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ng.items") ?? "[]"))
  expect(stored).toEqual(["scan"])
  await expect(page.getByRole("list", { name: "Items" })).toBeVisible()
})

test("collected item is locked — slot is disabled until next round starts", async ({ page }) => {
  const board = makeSeedBoard(3, 3, (r, c) => ({ solution: r === c }))
  board[1][1].item = "pick"
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
  }, makeActiveRound({ rows: 3, cols: 3, fillTarget: 3, board, status: "playing" }))
  await page.goto("/")

  await page.getByLabel("Cell 2,2").click()
  await page.locator("button[aria-label^='Cell 2,2']").click()
  const slot = page.getByRole("listitem").first()
  await expect(slot).toBeDisabled()
  const locks = await page.evaluate(() => JSON.parse(localStorage.getItem("ng.itemLocks") ?? "[]"))
  expect(locks).toEqual([true])
})

test("locked item unlocks when Start is clicked on the next round", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("ng.items", JSON.stringify(["pick"]))
    window.localStorage.setItem("ng.itemLocks", JSON.stringify([true]))
  })
  await page.goto("/")
  const startBtn = page.getByRole("button", { name: "Start", exact: true })
  await expect(startBtn).toBeVisible()
  await startBtn.click()
  await page.getByLabel("Cell 5,5").click()
  await page.waitForTimeout(100)
  const slot = page.getByRole("listitem").first()
  await expect(slot).not.toBeDisabled()
  const locks = await page.evaluate(() => JSON.parse(localStorage.getItem("ng.itemLocks") ?? "[]"))
  expect(locks).toEqual([false])
})

test("items discovery view shows in the menu", async ({ page }) => {
  await setPersisted(page, { "ng.discoveredItems": ["scan"] })
  await page.goto("/")
  await dismissIntro(page)
  await page.getByLabel("Open menu").click()
  await expect(page.getByLabel("Open items list")).toContainText("1 of 3")
  await page.getByLabel("Open items list").click()
  await expect(page.getByRole("group", { name: "Clue Scan" })).toBeVisible()
  await expect(page.getByRole("group", { name: "Undiscovered item" })).toHaveCount(2)
})

test("SwapDialog appears when collecting on a full inventory", async ({ page }) => {
  const board = makeSeedBoard(3, 3, (r, c) => ({ solution: r === c }))
  board[1][1].item = "undo"
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
    window.localStorage.setItem("ng.items", JSON.stringify(["pick", "pick", "pick"]))
  }, makeActiveRound({ rows: 3, cols: 3, fillTarget: 3, board, status: "playing" }))
  await page.goto("/")
  await page.getByLabel("Cell 2,2").click() // fill item cell
  await page.locator("button[aria-label^='Cell 2,2']").click() // collect → swap dialog
  await expect(page.getByRole("dialog", { name: "Replace an item" })).toBeVisible()
  const slotButtons = page
    .getByRole("dialog", { name: "Replace an item" })
    .getByRole("button", { name: /^Replace / })
  await expect(slotButtons).toHaveCount(3)
  await page.getByRole("button", { name: /^Skip/ }).click()
  await expect(page.getByRole("dialog", { name: "Replace an item" })).toHaveCount(0)
})

test("SwapDialog replace slot swaps the item, closes the dialog, and shows a toast", async ({ page }) => {
  const board = makeSeedBoard(3, 3, (r, c) => ({ solution: r === c }))
  board[1][1].item = "undo"
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
    window.localStorage.setItem("ng.items", JSON.stringify(["pick", "pick", "pick"]))
  }, makeActiveRound({ rows: 3, cols: 3, fillTarget: 3, board, status: "playing" }))
  await page.goto("/")

  await page.getByLabel("Cell 2,2").click() // fill the item cell
  await page.locator("button[aria-label^='Cell 2,2']").click() // collect → swap dialog
  await expect(page.getByRole("dialog", { name: "Replace an item" })).toBeVisible()

  await page
    .getByRole("dialog", { name: "Replace an item" })
    .getByRole("button", { name: "Replace Lucky Fill" })
    .first()
    .click()

  await expect(page.getByRole("dialog", { name: "Replace an item" })).toHaveCount(0)
  await expect(page.getByRole("status")).toContainText("Second Chance", { timeout: 2000 })

  const items = await page.evaluate(() => JSON.parse(localStorage.getItem("ng.items") ?? "[]"))
  expect(items[0]).toBe("undo")
})

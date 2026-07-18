import { test, expect } from "@playwright/test"
import { dismissIntro, freshSession, makeActiveRound, makeSeedBoard, readBoard, setPersisted } from "./_helpers"

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

test("Lucky Fill fills a genuinely correct cell — not just any hidden one — and is consumed", async ({ page }) => {
  // Diagonal solution: (0,0),(1,1),(2,2). Every other cell is wrong, so
  // this can distinguish "picked a real solution cell" from "picked any
  // hidden cell at all."
  const board = makeSeedBoard(3, 3, (r, c) => ({ solution: r === c }))
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
    window.localStorage.setItem("ng.items", JSON.stringify(["pick"]))
  }, makeActiveRound({ rows: 3, cols: 3, fillTarget: 3, board, status: "playing" }))
  await page.goto("/")

  const before = (await readBoard(page)).flat()
  await page.getByRole("listitem").first().click()
  const after = (await readBoard(page)).flat()

  // Filling a cell can satisfy its row/column's clue and auto-cross-out
  // the rest of that line — a real, separate feature (see
  // gameplay.spec.ts) — so isolate the cell that actually became
  // *filled* rather than asserting nothing else on the board changed.
  const newlyFilled = before.filter((cell, i) => cell.state === "hidden" && after[i].state === "filled")
  expect(newlyFilled).toHaveLength(1)
  const [{ r, c }] = newlyFilled
  expect(board[r - 1][c - 1].solution).toBe(true)

  const items = await page.evaluate(() => JSON.parse(localStorage.getItem("ng.items") ?? "[]"))
  expect(items).not.toContain("pick")
})

test("Lucky Fill only ever fills genuinely correct cells across repeated uses", async ({ page }) => {
  // A sparser, scattered solution on a bigger board — 8 solution cells out
  // of 25, spread out rather than clustered — so repeated random picks
  // have to keep landing correctly rather than happening to be right once.
  const board = makeSeedBoard(5, 5, (r, c) => ({ solution: (r + c) % 3 === 0 }))
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
    window.localStorage.setItem("ng.items", JSON.stringify(["pick", "pick", "pick"]))
  }, makeActiveRound({ rows: 5, cols: 5, fillTarget: 8, board, status: "playing" }))
  await page.goto("/")

  for (let i = 0; i < 3; i++) {
    const before = (await readBoard(page)).flat()
    await page.getByRole("listitem").first().click()
    const after = (await readBoard(page)).flat()
    const newlyFilled = before.filter((cell, idx) => cell.state === "hidden" && after[idx].state === "filled")
    expect(newlyFilled).toHaveLength(1)
    const [{ r, c }] = newlyFilled
    expect(board[r - 1][c - 1].solution).toBe(true)
  }

  const items = await page.evaluate(() => JSON.parse(localStorage.getItem("ng.items") ?? "[]"))
  expect(items).toEqual([])
})

test("Lucky Fill can trigger a win when it fills the last remaining solution cell", async ({ page }) => {
  const board = makeSeedBoard(3, 3, (r, c) => ({ solution: r === c }))
  // Two of the three diagonal cells are already correctly filled; only
  // (2,2) remains hidden, so Lucky Fill has exactly one possible target
  // and it's the winning move.
  board[0][0].state = "filled"
  board[1][1].state = "filled"
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
    window.localStorage.setItem("ng.items", JSON.stringify(["pick"]))
  }, makeActiveRound({ rows: 3, cols: 3, fillTarget: 3, board, status: "playing" }))
  await page.goto("/")

  await expect(page.getByText("Level complete")).toHaveCount(0)
  await page.getByRole("listitem").first().click()
  await expect(page.getByText("Level complete")).toBeVisible({ timeout: 2000 })
})

test("Lucky Fill respects the Mirror modifier — fills the symmetric cell too", async ({ page }) => {
  // Row 0 solution: [true, false, true] — a mirrored pair around the
  // centre column. Whichever half Lucky Fill's random pick lands on,
  // fillCell's mirror handling should fill the other half for free too.
  const board = makeSeedBoard(3, 3, () => ({ solution: false }))
  board[0][0].solution = true
  board[0][2].solution = true
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
    window.localStorage.setItem("ng.items", JSON.stringify(["pick"]))
  }, makeActiveRound({
    rows: 3, cols: 3, fillTarget: 2, modifierId: "mirror", board, status: "playing",
  }))
  await page.goto("/")

  await page.getByRole("listitem").first().click()
  await expect(page.getByLabel("Cell 1,1")).toHaveAttribute("data-cell-state", "filled")
  await expect(page.getByLabel("Cell 1,3")).toHaveAttribute("data-cell-state", "filled")
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

test("Clue Scan highlights exactly the hidden solution cells — not wrong cells, not already-filled ones", async ({ page }) => {
  // Diagonal solution: (0,0),(1,1),(2,2). (0,0) is already filled, so only
  // (1,1) and (2,2) should ring — never any of the six off-diagonal cells.
  const board = makeSeedBoard(3, 3, (r, c) => ({ solution: r === c }))
  board[0][0].state = "filled"
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
    window.localStorage.setItem("ng.items", JSON.stringify(["scan"]))
  }, makeActiveRound({ rows: 3, cols: 3, fillTarget: 3, board, status: "playing" }))
  await page.goto("/")

  await page.getByRole("listitem").first().click()
  // Match on class *content* rather than a raw CSS selector string — the
  // scan ring (ring-2 + a color-success class) and the unrelated
  // item-icon glow (also ring-2, but color-accent) both exist in Cell.tsx,
  // so a bare ".ring-2" selector would be ambiguous between the two.
  const ringedCells = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button[aria-label^='Cell ']"))
      .filter((b) =>
        Array.from(b.querySelectorAll("span")).some(
          (s) => s.classList.contains("ring-2") && [...s.classList].some((c) => c.includes("color-success")),
        ),
      )
      .map((b) => b.getAttribute("aria-label")),
  )
  expect(ringedCells.sort()).toEqual(["Cell 2,2", "Cell 3,3"])
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

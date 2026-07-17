import { test, expect } from "@playwright/test"
import {
  dismissIntro,
  freshSession,
  expectNoOverflow,
  makeActiveRound,
  makeSeedBoard,
} from "./_helpers"

test.beforeEach(async ({ page }) => {
  await freshSession(page)
})

test("page fills the viewport exactly with no scroll overflow", async ({ page }) => {
  await page.goto("/")
  await dismissIntro(page)
  await page.waitForSelector("button[aria-label='Cell 1,1']")
  await expectNoOverflow(page)
})

test("page fills viewport after orientation/resize", async ({ page }) => {
  await page.goto("/")
  await dismissIntro(page)
  await page.waitForSelector("button[aria-label='Cell 1,1']")
  await page.setViewportSize({ width: 1024, height: 768 })
  await expectNoOverflow(page)
  await page.setViewportSize({ width: 360, height: 740 })
  await expectNoOverflow(page)
})

test("html, body, root all carry the same height", async ({ page }) => {
  await page.goto("/")
  await dismissIntro(page)
  const sizes = await page.evaluate(() => ({
    html: document.documentElement.getBoundingClientRect().height,
    body: document.body.getBoundingClientRect().height,
    root: document.getElementById("root")?.getBoundingClientRect().height ?? 0,
    viewport: window.innerHeight,
  }))
  expect(sizes.html).toBe(sizes.viewport)
  expect(sizes.body).toBe(sizes.viewport)
  expect(sizes.root).toBe(sizes.viewport)
})

test("playbar shows level, modifier, mistakes, timer", async ({ page }) => {
  await page.goto("/")
  await dismissIntro(page)
  await expect(page.getByLabel(/Level \d+/)).toBeVisible()
  // Open menu — should reveal stat cards.
  await page.getByLabel("Open menu").click()
  // Stat labels live in DOM as title-case ("Level", "Time"…) and are
  // CSS-uppercased visually.
  await expect(page.getByText("Level", { exact: true })).toBeVisible()
  await expect(page.getByText("Mistakes left")).toBeVisible()
  await expect(page.getByText("Time", { exact: true })).toBeVisible()
  await expect(page.getByText("Best Lv.")).toBeVisible()
})

test("PWA manifest is linked and contains the required fields", async ({ page }) => {
  await page.goto("/")
  await dismissIntro(page)
  const manifestHref = await page.getAttribute("link[rel=manifest]", "href")
  expect(manifestHref).toBeTruthy()

  const response = await page.request.get(manifestHref!)
  expect(response.ok()).toBe(true)
  const manifest = await response.json()
  expect(manifest.name).toMatch(/Nonogram/i)
  expect(manifest.display).toBe("standalone")
  expect(manifest.icons.length).toBeGreaterThanOrEqual(2)
  expect(manifest.icons.some((i: { sizes: string }) => i.sizes === "192x192")).toBe(true)
  expect(manifest.icons.some((i: { sizes: string }) => i.sizes === "512x512")).toBe(true)
})

// Geometric alignment between the row/column clue headers and the puzzle
// cells they describe. Board.tsx tags each header wrapper with
// data-col-header/data-row-header specifically so this can be measured
// directly via getBoundingClientRect instead of eyeballed from a
// screenshot — every board size below is checked against every clue chip
// it renders, not just spot-checked.
for (const { rows, cols, label } of [
  { rows: 5, cols: 5, label: "5x5" },
  { rows: 9, cols: 9, label: "9x9 (Big Board at level 2)" },
  { rows: 18, cols: 18, label: "18x18 (Big Board at its cap — exercises 2-digit clues)" },
]) {
  test(`clue headers stay pixel-aligned with their column/row on a ${label} board`, async ({ page }) => {
    // A dense, irregular fill pattern so most lines produce multi-number
    // clues (including some as wide as the cell itself), which is exactly
    // the shape most likely to expose an alignment bug if one exists.
    const board = makeSeedBoard(rows, cols, (r, c) => ({
      solution: (r * 7 + c * 3) % 5 !== 0,
    }))
    await page.addInitScript((round) => {
      window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
    }, makeActiveRound({
      rows, cols, fillTarget: Math.max(3, Math.round(rows * cols * 0.6)),
      modifierId: "big", board, status: "playing",
    }))
    await page.goto("/")

    const misaligned = await page.evaluate(() => {
      const bad: unknown[] = []
      // Column headers are `div[data-col-header] > span.number` (direct
      // children). Row headers nest one level deeper —
      // `div[data-row-header] > span.pill > span.number` — so a plain
      // "span" selector on a row header would also catch the pill
      // wrapper itself, whose bounding box spans every number in the row
      // rather than any single cell.
      document.querySelectorAll("[data-col-header]").forEach((h) => {
        const c = h.getAttribute("data-col-header")
        const cell = document.querySelector(`button[data-row="0"][data-col="${c}"]`)
        if (!cell) return
        const cellRect = cell.getBoundingClientRect()
        const cellCenterX = cellRect.left + cellRect.width / 2
        h.querySelectorAll(":scope > span").forEach((s) => {
          const r = s.getBoundingClientRect()
          const diff = r.left + r.width / 2 - cellCenterX
          if (Math.abs(diff) > 1) bad.push({ axis: "col", c, text: s.textContent, diff })
        })
      })
      document.querySelectorAll("[data-row-header]").forEach((h) => {
        const r = h.getAttribute("data-row-header")
        const cell = document.querySelector(`button[data-row="${r}"][data-col="0"]`)
        if (!cell) return
        const cellRect = cell.getBoundingClientRect()
        const cellCenterY = cellRect.top + cellRect.height / 2
        h.querySelectorAll(":scope > span > span").forEach((s) => {
          const rect = s.getBoundingClientRect()
          const diff = rect.top + rect.height / 2 - cellCenterY
          if (Math.abs(diff) > 1) bad.push({ axis: "row", r, text: s.textContent, diff })
        })
      })
      return bad
    })
    expect(misaligned).toEqual([])
  })
}

test("clue header numbers exactly match the solution's run-lengths, not just their position", async ({ page }) => {
  // A hand-built 6x6 solution with multi-run rows/cols in a known layout,
  // independent from computeClues so this can't pass by tautology:
  //   col:  0 1 2 3 4 5
  //   row0: 1 1 0 0 1 1   -> clue [2,2]
  //   row1: 0 0 0 0 0 0   -> clue [0]
  //   row2: 1 0 1 1 0 1   -> clue [1,2,1]
  //   row3: 1 0 1 1 0 1   -> clue [1,2,1]
  //   row4: 0 0 0 0 0 0   -> clue [0]
  //   row5: 1 1 0 0 1 1   -> clue [2,2]
  const pattern = [
    [1, 1, 0, 0, 1, 1],
    [0, 0, 0, 0, 0, 0],
    [1, 0, 1, 1, 0, 1],
    [1, 0, 1, 1, 0, 1],
    [0, 0, 0, 0, 0, 0],
    [1, 1, 0, 0, 1, 1],
  ]
  const expectedRowClues = [[2, 2], [0], [1, 2, 1], [1, 2, 1], [0], [2, 2]]
  // Columns, read top-to-bottom, of the same pattern:
  //   col0: 1,0,1,1,0,1 -> [1,2,1]   col1: 1,0,0,0,0,1 -> [1,1]
  //   col2: 0,0,1,1,0,0 -> [2]       col3: 0,0,1,1,0,0 -> [2]
  //   col4: 1,0,0,0,0,1 -> [1,1]     col5: 1,0,1,1,0,1 -> [1,2,1]
  const expectedColClues = [[1, 2, 1], [1, 1], [2], [2], [1, 1], [1, 2, 1]]

  const board = makeSeedBoard(6, 6, (r, c) => ({ solution: pattern[r][c] === 1 }))
  await page.addInitScript((round) => {
    window.localStorage.setItem("ng.activeRound", JSON.stringify(round))
  }, makeActiveRound({ rows: 6, cols: 6, fillTarget: 12, board, status: "playing" }))
  await page.goto("/")

  const rendered = await page.evaluate(() => {
    const rows: number[][] = []
    document.querySelectorAll("[data-row-header]").forEach((h) => {
      const r = Number(h.getAttribute("data-row-header"))
      // Row pills nest their numbers inside an extra wrapper span — see
      // the alignment test above for why ":scope > span > span" is needed
      // here instead of a plain "span" selector.
      rows[r] = Array.from(h.querySelectorAll(":scope > span > span")).map((s) => Number(s.textContent))
    })
    const cols: number[][] = []
    document.querySelectorAll("[data-col-header]").forEach((h) => {
      const c = Number(h.getAttribute("data-col-header"))
      cols[c] = Array.from(h.querySelectorAll(":scope > span")).map((s) => Number(s.textContent))
    })
    return { rows, cols }
  })

  expect(rendered.rows).toEqual(expectedRowClues)
  expect(rendered.cols).toEqual(expectedColClues)
})

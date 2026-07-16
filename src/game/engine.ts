import type { Board, Cell, CellState, Clues, LevelConfig, ModifierId } from "./types"
import { MODIFIERS, MODIFIER_POOL } from "./modifiers"
import { PALETTES } from "./palette"
import { rollItem } from "./items"

export function makeEmptyBoard(rows: number, cols: number): Board {
  return Array.from({ length: rows }, () =>
    Array.from(
      { length: cols },
      (): Cell => ({
        solution: false,
        state: "hidden",
        bonus: false,
        mirror: false,
        item: null,
      }),
    ),
  )
}

function randomSolutionGrid(
  rows: number,
  cols: number,
  fillTarget: number,
  mirrored: boolean,
): boolean[][] {
  const grid = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false))
  if (mirrored) {
    const halfCols = Math.ceil(cols / 2)
    // fillTarget applies to the whole grid; the mirror fills the other half
    // for free, so we only need to place roughly half the cells ourselves.
    const halfTarget = Math.round(fillTarget / 2)
    let placed = 0
    let attempts = 0
    while (placed < halfTarget && attempts < rows * halfCols * 20) {
      attempts++
      const r = Math.floor(Math.random() * rows)
      const c = Math.floor(Math.random() * halfCols)
      if (grid[r][c]) continue
      const mirrorC = cols - 1 - c
      grid[r][c] = true
      grid[r][mirrorC] = true
      placed += mirrorC === c ? 1 : 2
    }
  } else {
    let placed = 0
    let attempts = 0
    while (placed < fillTarget && attempts < rows * cols * 20) {
      attempts++
      const r = Math.floor(Math.random() * rows)
      const c = Math.floor(Math.random() * cols)
      if (grid[r][c]) continue
      grid[r][c] = true
      placed++
    }
  }
  return grid
}

/**
 * Generate a fresh puzzle: a random solution grid (no logical-solvability
 * guarantee — same trade-off Minesweeper makes with random mine placement)
 * wrapped into board cells. Mirror boards are generated symmetrically so a
 * filled cell always has a same-value twin across the vertical axis.
 */
export function generateBoard(
  rows: number,
  cols: number,
  fillTarget: number,
  modifierId: ModifierId,
): Board {
  const totalCells = rows * cols
  const target = Math.min(Math.max(fillTarget, 1), totalCells - 1)
  const mirrored = modifierId === "mirror"

  let grid = randomSolutionGrid(rows, cols, target, mirrored)
  let filledCount = grid.flat().filter(Boolean).length
  let attempts = 0
  // Guard against a degenerate all-empty/all-filled roll (rare, but the
  // random walk above can undershoot on tiny or near-full boards).
  while ((filledCount === 0 || filledCount === totalCells) && attempts < 8) {
    grid = randomSolutionGrid(rows, cols, target, mirrored)
    filledCount = grid.flat().filter(Boolean).length
    attempts++
  }

  return grid.map((row) =>
    row.map((solution, c) => ({
      solution,
      state: "hidden" as CellState,
      bonus: false,
      mirror: mirrored && c !== cols - 1 - c,
      item: null,
    })),
  )
}

function runLengths(cells: boolean[]): number[] {
  const runs: number[] = []
  let current = 0
  for (const filled of cells) {
    if (filled) current++
    else {
      if (current > 0) runs.push(current)
      current = 0
    }
  }
  if (current > 0) runs.push(current)
  return runs.length > 0 ? runs : [0]
}

export function computeClues(board: Board): Clues {
  const cols = board[0]?.length ?? 0
  const rows = board.map((row) => runLengths(row.map((c) => c.solution)))
  const colClues: number[][] = []
  for (let c = 0; c < cols; c++) {
    const col: boolean[] = []
    for (let r = 0; r < board.length; r++) col.push(board[r][c].solution)
    colClues.push(runLengths(col))
  }
  return { rows, cols: colClues }
}

export function rowStates(board: Board, r: number): CellState[] {
  return board[r].map((c) => c.state)
}

export function colStates(board: Board, c: number): CellState[] {
  return board.map((row) => row[c].state)
}

/** A line is "done" when its currently-filled cells' run lengths match the clue exactly. */
export function lineSatisfied(states: CellState[], clue: number[]): boolean {
  const runs = runLengths(states.map((s) => s === "filled"))
  if (runs.length !== clue.length) return false
  for (let i = 0; i < runs.length; i++) if (runs[i] !== clue[i]) return false
  return true
}

export function placeBonusCells(board: Board, count: number): Board {
  if (count <= 0) return board
  const rows = board.length
  const cols = board[0].length
  const next = board.map((row) => row.map((c) => ({ ...c })))
  let placed = 0
  let attempts = 0
  while (placed < count && attempts < rows * cols * 5) {
    attempts++
    const r = Math.floor(Math.random() * rows)
    const c = Math.floor(Math.random() * cols)
    const cell = next[r][c]
    if (!cell.solution || cell.bonus) continue
    cell.bonus = true
    placed++
  }
  return next
}

/**
 * Drop a single random item onto a cell that belongs to the solution
 * (excluding bonus cells). The player must fill AND tap the cell to
 * collect — no auto-grants. Returns the modified board.
 */
export function placeItems(board: Board, level: number): Board {
  const rows = board.length
  const cols = board[0].length
  const next = board.map((row) => row.map((c) => ({ ...c })))
  const item: Cell["item"] = rollItem(level)
  for (let attempts = 0; attempts < rows * cols * 5; attempts++) {
    const r = Math.floor(Math.random() * rows)
    const c = Math.floor(Math.random() * cols)
    const cell = next[r][c]
    if (!cell.solution || cell.bonus || cell.item) continue
    cell.item = item
    return next
  }
  return next
}

/**
 * Fill one hidden cell. If it belongs to the solution, marks it filled
 * (and, on Mirror boards, its mirrored twin too — both are guaranteed to
 * share the same solution value by construction). If it doesn't belong to
 * the solution, the board is returned unchanged and `correct: false` tells
 * the caller to charge a mistake.
 */
export function fillCell(
  board: Board,
  r: number,
  c: number,
  mirrored: boolean,
): { board: Board; correct: boolean; filled: [number, number][] } {
  const cell = board[r][c]
  if (cell.state !== "hidden") return { board, correct: true, filled: [] }
  if (!cell.solution) return { board, correct: false, filled: [] }

  const next = board.map((row) => row.map((cc) => ({ ...cc })))
  next[r][c].state = "filled"
  const filled: [number, number][] = [[r, c]]

  if (mirrored) {
    const cols = board[0].length
    const mc = cols - 1 - c
    if (mc !== c && next[r][mc].state === "hidden" && next[r][mc].solution) {
      next[r][mc].state = "filled"
      filled.push([r, mc])
    }
  }

  return { board: next, correct: true, filled }
}

export function markCell(board: Board, r: number, c: number): Board {
  const cell = board[r][c]
  if (cell.state === "filled") return board
  const next = board.map((row) => row.map((cc) => ({ ...cc })))
  next[r][c].state = next[r][c].state === "marked" ? "hidden" : "marked"
  return next
}

/**
 * Quality-of-life cascade: once a row or column's filled run-lengths match
 * its clue exactly, cross out (mark) every remaining hidden cell in that
 * line — there's nothing left it could legally contain.
 */
export function autoMarkSatisfiedLines(
  board: Board,
  clues: Clues,
  touched: [number, number][],
): Board {
  if (touched.length === 0) return board
  let next = board
  let mutated = false
  const ensureClone = () => {
    if (!mutated) {
      next = board.map((row) => row.map((cc) => ({ ...cc })))
      mutated = true
    }
  }

  const rowsToCheck = new Set(touched.map(([r]) => r))
  const colsToCheck = new Set(touched.map(([, c]) => c))

  for (const r of rowsToCheck) {
    if (!lineSatisfied(rowStates(next, r), clues.rows[r])) continue
    for (let c = 0; c < next[r].length; c++) {
      if (next[r][c].state === "hidden") {
        ensureClone()
        next[r][c].state = "marked"
      }
    }
  }
  for (const c of colsToCheck) {
    if (!lineSatisfied(colStates(next, c), clues.cols[c])) continue
    for (let r = 0; r < next.length; r++) {
      if (next[r][c].state === "hidden") {
        ensureClone()
        next[r][c].state = "marked"
      }
    }
  }
  return next
}

export function checkWin(board: Board): boolean {
  for (const row of board) {
    for (const cell of row) {
      if (cell.solution !== (cell.state === "filled")) return false
    }
  }
  return true
}

/** Reveal the answer key at a loss: fill every cell that should be filled. */
export function revealSolutionAtLoss(board: Board): Board {
  return board.map((row) =>
    row.map((cell) =>
      cell.solution && cell.state !== "filled" ? { ...cell, state: "filled" as const } : cell,
    ),
  )
}

export function hiddenCorrectCells(board: Board): [number, number][] {
  const out: [number, number][] = []
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      if (board[r][c].solution && board[r][c].state === "hidden") out.push([r, c])
    }
  }
  return out
}

// ----- Level configuration -----

export function configForLevel(level: number, opts?: { force?: ModifierId }): LevelConfig {
  // Smooth growth: 5x5 at L1, capping near 15x15 with rising fill density.
  const baseRows = Math.min(5 + Math.floor((level - 1) / 2), 15)
  const baseCols = Math.min(5 + Math.floor((level - 1) / 2), 15)
  const density = 0.35 + Math.min(0.1, (level - 1) * 0.006)
  let rows = baseRows
  let cols = baseCols
  let fillTarget = Math.round(rows * cols * density)
  let bonusCells = 0
  let countdown: number | null = null
  let bonusValue = 5
  let mistakeLimit = 3

  const modifierId =
    opts?.force ?? MODIFIER_POOL[Math.floor(Math.random() * MODIFIER_POOL.length)]
  const modifier = MODIFIERS[modifierId]

  switch (modifier.id) {
    case "quick": {
      // Smaller board, slightly denser, AND a countdown.
      rows = Math.max(5, baseRows - 2)
      cols = Math.max(5, baseCols - 2)
      fillTarget = Math.round(rows * cols * (density + 0.03))
      const totalCells = rows * cols
      countdown = Math.max(25, Math.round(totalCells * 1.1 + level * 3))
      break
    }
    case "dense":
      fillTarget = Math.round(rows * cols * (density + 0.08))
      break
    case "bonus": {
      // Countdown mode where correctly-filled bonus cells extend the clock.
      bonusCells = 2 + Math.floor(level / 3)
      bonusValue = 6
      const totalCells = rows * cols
      countdown = Math.max(20, Math.round(totalCells * 0.85 + level * 2))
      break
    }
    case "mirror":
      // No size change — symmetric generation is handled by generateBoard.
      break
    case "big": {
      // Larger board with slightly relaxed density. Designed for panning.
      rows = Math.min(18, baseRows + 4)
      cols = Math.min(18, baseCols + 4)
      fillTarget = Math.round(rows * cols * Math.max(0.28, density - 0.03))
      break
    }
    case "precision": {
      // Slightly smaller board, normal density, zero mistake tolerance.
      rows = Math.max(5, baseRows - 1)
      cols = Math.max(5, baseCols - 1)
      fillTarget = Math.round(rows * cols * density)
      mistakeLimit = 0
      break
    }
    default:
      break
  }

  fillTarget = Math.min(Math.max(fillTarget, 3), rows * cols - 3)

  return {
    rows,
    cols,
    fillTarget,
    bonusCells,
    mistakeLimit,
    modifier,
    paletteSeed: Math.floor(Math.random() * PALETTES.length),
    level,
    countdown,
    bonusValue,
  }
}

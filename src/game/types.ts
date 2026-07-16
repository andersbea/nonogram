import type { ItemType } from "./items"

export type CellState = "hidden" | "filled" | "marked"

export interface Cell {
  solution: boolean // whether this cell must be filled to solve the puzzle
  state: CellState
  bonus: boolean // bonus cell - grants extra time when correctly filled
  mirror: boolean // this cell is part of a mirrored pair (Mirror modifier, cosmetic)
  // Inventory item embedded in the cell. Correctly filling the cell exposes a
  // badge; the player has to tap the badge to actually pocket the item.
  item: ItemType | null
}

export type Board = Cell[][]

export type ModifierId =
  | "calm"
  | "quick"
  | "bonus"
  | "dense"
  | "big"
  | "mirror"
  | "precision"

export interface Modifier {
  id: ModifierId
  name: string
  description: string
  icon: string // lucide name
}

export interface LevelConfig {
  rows: number
  cols: number
  fillTarget: number // number of cells that must be filled to solve the puzzle
  bonusCells: number
  mistakeLimit: number // wrong fills allowed before losing (0 = any mistake loses)
  modifier: Modifier
  paletteSeed: number
  level: number
  // For countdown modes: starting time in seconds. null/undefined = count up.
  countdown: number | null
  // Seconds gained per bonus cell correctly filled (positive in countdown
  // mode = add time remaining; in count-up mode = subtract from elapsed).
  bonusValue: number
}

export type GameStatus = "ready" | "playing" | "won" | "lost"

/** Row/column clue numbers derived from a board's solution. */
export interface Clues {
  rows: number[][]
  cols: number[][]
}

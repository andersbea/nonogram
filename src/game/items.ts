// Consumable items the player can hold (up to 3 at a time). Earned by
// clearing levels; types are weighted so "Second Chance" — the strongest
// one — gets rarer as the player climbs.

export type ItemType = "undo" | "pick" | "scan"

export const ITEM_MAX = 3

export interface ItemDef {
  id: ItemType
  name: string
  description: string
  icon: string // lucide icon name
}

export const ITEMS: Record<ItemType, ItemDef> = {
  undo: {
    id: "undo",
    name: "Second Chance",
    description: "Auto-cancels your next mistake. Saves the round.",
    icon: "Heart",
  },
  pick: {
    id: "pick",
    name: "Lucky Fill",
    description: "Correctly fills one random hidden cell.",
    icon: "Dice5",
  },
  scan: {
    id: "scan",
    name: "Clue Scan",
    description: "Briefly highlights every cell that should be filled.",
    icon: "Radar",
  },
}

/**
 * Roll a random item to award the player after clearing a level.
 * Second Chance weight decays linearly with level so survivability is most
 * generous early on, and other items dominate at higher levels.
 */
export function rollItem(level: number): ItemType {
  const undoWeight = Math.max(1, 30 - level)
  const pickWeight = 30
  const scanWeight = 30
  const total = undoWeight + pickWeight + scanWeight
  const roll = Math.random() * total
  if (roll < undoWeight) return "undo"
  if (roll < undoWeight + pickWeight) return "pick"
  return "scan"
}

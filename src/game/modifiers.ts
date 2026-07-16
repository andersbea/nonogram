import type { Modifier, ModifierId } from "./types"

export const MODIFIERS: Record<ModifierId, Modifier> = {
  calm: {
    id: "calm",
    name: "Calm",
    description: "A standard board. Timer counts up.",
    icon: "Waves",
  },
  bonus: {
    id: "bonus",
    name: "Bonus Cells",
    description:
      "Countdown. Sparkling cells add seconds to the clock when correctly filled — find them to survive.",
    icon: "Sparkles",
  },
  mirror: {
    id: "mirror",
    name: "Mirror",
    description: "The picture is left-right symmetric — fill one side and its mirror fills too.",
    icon: "Link2",
  },
  quick: {
    id: "quick",
    name: "Quick Round",
    description: "Countdown. Smaller board, but the clock is ticking — beat it before time runs out.",
    icon: "Zap",
  },
  dense: {
    id: "dense",
    name: "Dense Field",
    description: "More filled cells than usual at this level — busier clues.",
    icon: "Target",
  },
  big: {
    id: "big",
    name: "Big Board",
    description: "A larger field of play. Pan to explore — there's no rush.",
    icon: "Maximize",
  },
  precision: {
    id: "precision",
    name: "Precision",
    description: "No room for error — a single wrong fill ends the round. Steady aim wins.",
    icon: "Crosshair",
  },
}

export const MODIFIER_POOL: ModifierId[] = [
  "calm",
  "calm",
  "bonus",
  "mirror",
  "quick",
  "dense",
  "big",
  "precision",
]

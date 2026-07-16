import { Heart, Menu, MousePointer2, X } from "lucide-react"
import type { LevelConfig } from "@/game/types"
import type { Palette } from "@/game/palette"
import { formatMMSS } from "@/lib/format"
import { Button } from "./ui/button"
import { cn } from "@/lib/utils"

interface Props {
  config: LevelConfig
  palette: Palette
  mistakesLeft: number
  seconds: number
  markMode: boolean
  onToggleMarkMode: () => void
  onOpenMenu: () => void
}

export function PlayBar({
  config,
  palette,
  mistakesLeft,
  seconds,
  markMode,
  onToggleMarkMode,
  onOpenMenu,
}: Props) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/70 px-3 py-2 backdrop-blur-xl sm:gap-3 sm:px-4">
      {/* flex-1 + min-w-0 makes the modifier label expand into whatever space
          the right cluster doesn't claim, instead of shrinking to its
          content's intrinsic size. */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div
          className="h-7 w-7 shrink-0 rounded-md text-black flex items-center justify-center text-[11px] font-mono font-semibold"
          style={{ background: `linear-gradient(135deg, ${palette.a}, ${palette.b})` }}
          aria-label={`Level ${config.level}`}
        >
          {String(config.level).padStart(2, "0")}
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="text-[9px] uppercase tracking-[0.2em] text-[var(--color-muted)] leading-tight">
            {palette.name}
          </span>
          <span className="truncate text-xs font-semibold leading-tight text-[var(--color-fg)]">
            {config.modifier.name}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <div
          className={cn(
            "flex items-center gap-1.5 font-mono tabular-nums text-sm",
            mistakesLeft <= 0 ? "text-[var(--color-danger)]" : "text-[var(--color-fg)]",
          )}
          aria-label={`${mistakesLeft} mistakes remaining`}
        >
          <Heart
            className={cn(
              "h-3.5 w-3.5",
              mistakesLeft <= 0 ? "text-[var(--color-danger)]" : "text-[var(--color-fg-soft)]",
            )}
            strokeWidth={2.5}
          />
          {mistakesLeft}
        </div>
        <div className="font-mono tabular-nums text-sm text-[var(--color-fg)]">{formatMMSS(seconds)}</div>

        {/* Fill/mark tool switch — a pill with a sliding thumb, matching the
            two icons it toggles between. Drag paints whichever tool is active;
            right-click (or shift/alt-click) always marks regardless. */}
        <button
          type="button"
          onClick={onToggleMarkMode}
          aria-pressed={markMode}
          aria-label={markMode ? "Switch to fill mode" : "Switch to mark mode"}
          title={markMode ? "Drag to mark cells — tap to switch to fill" : "Drag to fill cells — tap to switch to mark"}
          className="relative inline-flex h-9 w-[72px] shrink-0 items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/60 p-0.5 transition-colors active:scale-[0.98]"
        >
          <span
            aria-hidden
            className="absolute h-8 w-8 rounded-full bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-2))] shadow-md transition-transform duration-200"
            style={{ transform: `translateX(${markMode ? 36 : 0}px)` }}
          />
          <span className="relative z-10 flex w-8 items-center justify-center">
            <MousePointer2
              className={cn("h-4 w-4 transition-colors", !markMode ? "text-black" : "text-[var(--color-fg-soft)]")}
            />
          </span>
          <span className="relative z-10 flex w-8 items-center justify-center">
            <X
              className={cn("h-4 w-4 transition-colors", markMode ? "text-black" : "text-[var(--color-fg-soft)]")}
              strokeWidth={2.5}
            />
          </span>
        </button>

        <Button variant="outline" size="icon" onClick={onOpenMenu} aria-label="Open menu">
          <Menu className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

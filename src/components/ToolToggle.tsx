import { MousePointer2, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  markMode: boolean
  onToggleMarkMode: () => void
}

/**
 * Fill/mark tool switch. Lives in its own bar below the board (rather than
 * up in the PlayBar) so it sits within comfortable one-thumb reach on a
 * phone. Drag paints whichever tool is active; right-click (or
 * shift/alt-click) always marks regardless.
 */
export function ToolToggle({ markMode, onToggleMarkMode }: Props) {
  return (
    <div className="flex items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/70 px-3 py-2 backdrop-blur-xl">
      <button
        type="button"
        onClick={onToggleMarkMode}
        aria-pressed={markMode}
        aria-label={markMode ? "Switch to fill mode" : "Switch to mark mode"}
        title={markMode ? "Drag to mark cells — tap to switch to fill" : "Drag to fill cells — tap to switch to mark"}
        className="relative inline-flex h-12 w-24 shrink-0 items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)]/60 p-1 transition-colors active:scale-[0.98]"
      >
        {/* Explicit top/left rather than an absolutely positioned element's
            implicit static position — the pill has 4px padding (p-1) on
            every side and its two w-10 icon slots sit flush against each
            other starting at that padding edge, so the 40px thumb aligns
            exactly over either icon at left = 4px (idle) or left = 4px +
            40px (on). */}
        <span
          aria-hidden
          className="absolute left-1 top-1 h-10 w-10 rounded-full bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-2))] shadow-md transition-transform duration-200"
          style={{ transform: `translateX(${markMode ? 40 : 0}px)` }}
        />
        <span className="relative z-10 flex w-10 items-center justify-center">
          <MousePointer2
            className={cn("h-5 w-5 transition-colors", !markMode ? "text-black" : "text-[var(--color-fg-soft)]")}
          />
        </span>
        <span className="relative z-10 flex w-10 items-center justify-center">
          <X
            className={cn("h-5 w-5 transition-colors", markMode ? "text-black" : "text-[var(--color-fg-soft)]")}
            strokeWidth={2.5}
          />
        </span>
      </button>
    </div>
  )
}

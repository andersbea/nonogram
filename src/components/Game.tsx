import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  autoMarkSatisfiedLines,
  checkWin,
  computeClues,
  configForLevel,
  fillCell,
  generateBoard,
  hiddenCorrectCells,
  markCell,
  placeBonusCells,
  placeItems,
  revealSolutionAtLoss,
} from "@/game/engine"
import { ITEM_MAX, ITEMS, type ItemType } from "@/game/items"
import { paletteFor } from "@/game/palette"
import {
  ACTIVE_ROUND_KEY,
  buildSnapshot,
  configFromSaved,
  readActiveRound,
  readPersistedLevel,
} from "@/game/round-storage"
import type { Board as BoardT, LevelConfig, ModifierId } from "@/game/types"
import { useGameTimer, SHAKE_DURATION_MS } from "@/hooks/useGameTimer"
import { useLocalStorage } from "@/hooks/useLocalStorage"
import { useTheme } from "@/hooks/useTheme"
import { multiTouchRef } from "@/lib/touch-state"
import { Board } from "./Board"
import { ItemsBar } from "./ItemsBar"
import { MenuSheet } from "./MenuSheet"
import { Overlay } from "./Overlay"
import { PlayBar } from "./PlayBar"
import { ReadyOverlay } from "./ReadyOverlay"
import { SwapDialog } from "./SwapDialog"

// ─── Timing constants ─────────────────────────────────────────────────────────

/** How long a toast notification stays visible (ms). */
const TOAST_DURATION_MS = 1_800
/** How long the +Ns float text is visible after a bonus cell (ms). */
const FLOAT_LIFETIME_MS = 900
/** How long Clue Scan highlights the remaining answer (ms). */
const SCAN_DURATION_MS = 2_000

// ─── Gradient colours per modifier ───────────────────────────────────────────
// Applied as --gradient-a/b on :root so the animated background blobs in
// App.tsx pick up the active modifier's colour scheme automatically.
const MODIFIER_GRADIENTS: Record<ModifierId, [string, string]> = {
  calm:      ["oklch(0.78 0.18 220)", "oklch(0.75 0.15 180)"], // blue / cyan
  quick:     ["oklch(0.80 0.18 145)", "oklch(0.75 0.15 170)"], // green / teal
  bonus:     ["oklch(0.82 0.16 80)",  "oklch(0.78 0.18 40)"],  // gold / amber
  dense:     ["oklch(0.72 0.21 35)",  "oklch(0.75 0.18 60)"],  // orange / gold
  big:       ["oklch(0.72 0.18 285)", "oklch(0.75 0.15 310)"], // violet / purple
  mirror:    ["oklch(0.72 0.21 15)",  "oklch(0.75 0.15 340)"], // red / magenta
  precision: ["oklch(0.76 0.16 195)", "oklch(0.73 0.13 220)"], // teal / blue
}

// ─── Float text ───────────────────────────────────────────────────────────────
interface FloatText {
  id: number
  text: string
}

/** Build a fresh board for `cfg`: solution grid, bonus cells, and one item. */
function buildRoundBoard(cfg: LevelConfig): BoardT {
  let b = generateBoard(cfg.rows, cfg.cols, cfg.fillTarget, cfg.modifier.id)
  if (cfg.bonusCells > 0) b = placeBonusCells(b, cfg.bonusCells)
  b = placeItems(b, cfg.level)
  return b
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Game() {
  // Try to restore an in-flight round first. Falls back to "fresh round at
  // the persisted current level" if nothing is saved or the save is stale.
  const savedRound = readActiveRound()
  const initialLevel = readPersistedLevel()
  const [config, setConfig] = useState<LevelConfig>(() =>
    savedRound
      ? configFromSaved(savedRound)
      : configForLevel(initialLevel, initialLevel === 1 ? { force: "calm" } : undefined),
  )
  const [board, setBoard] = useState<BoardT>(() =>
    savedRound ? savedRound.board : buildRoundBoard(config),
  )
  const [status, setStatus] = useState(savedRound?.status ?? "ready" as const)
  const [wrongFlash, setWrongFlash] = useState<[number, number] | null>(
    savedRound?.wrongFlash ?? null,
  )
  const [shake, setShake] = useState(false)
  const [floats, setFloats] = useState<FloatText[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [introDismissed, setIntroDismissed] = useState(savedRound?.status === "playing")
  const [lossReason, setLossReason] = useState<"mistakes" | "time" | null>(
    savedRound?.lossReason ?? null,
  )
  const [itemToast, setItemToast] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [pendingItem, setPendingItem] = useState<ItemType | null>(null)
  const [mistakesUsed, setMistakesUsed] = useState(savedRound?.mistakesUsed ?? 0)

  const floatId = useRef(0)
  // Live ref so timer / event-handler closures always read the current config
  // without needing to be re-bound on every render.
  const configRef = useRef(config)
  configRef.current = config
  // Live ref to the current board so handleCountdownExpired can check whether
  // the player already solved the puzzle before declaring a time-loss.
  const boardRef = useRef(board)
  boardRef.current = board

  // ── Bug report action log ────────────────────────────────────────────────
  // Circular buffer (last 30 actions). Written with plain array mutation since
  // we never need React to re-render on log changes.
  const actionLogRef = useRef<string[]>([])
  const logAction = (label: string) => {
    const ts = new Date().toISOString().slice(11, 23) // "HH:MM:SS.mmm"
    const log = actionLogRef.current
    if (log.length >= 30) log.shift()
    log.push(`${ts} ${label}`)
  }

  // ── Persisted cross-round state ──────────────────────────────────────────
  const [bestLevel, setBestLevel] = useLocalStorage<number>("ng.bestLevel", 0)
  const [streak, setStreak] = useLocalStorage<number>("ng.streak", 0)
  const [totalWins, setTotalWins] = useLocalStorage<number>("ng.totalWins", 0)
  const [markMode, setMarkMode] = useLocalStorage<boolean>("ng.markMode", false)
  const [, setCurrentLevel] = useLocalStorage<number>("ng.currentLevel", initialLevel)
  const [unlockedModifiers, setUnlockedModifiers] = useLocalStorage<ModifierId[]>(
    "ng.unlockedModifiers", [],
  )
  const [bestTimes, setBestTimes] = useLocalStorage<Partial<Record<ModifierId, number>>>(
    "ng.bestTimes", {},
  )
  const [items, setItems] = useLocalStorage<ItemType[]>("ng.items", [])
  const [itemLocks, setItemLocks] = useLocalStorage<boolean[]>("ng.itemLocks", [])
  const [discoveredItems, setDiscoveredItems] = useLocalStorage<ItemType[]>(
    "ng.discoveredItems", [],
  )
  // Snapshot taken when "Start" is clicked — used to restore inventory on Retry.
  const [roundStartItems, setRoundStartItems] = useLocalStorage<ItemType[]>(
    "ng.roundStartItems", [],
  )
  const [roundStartItemLocks, setRoundStartItemLocks] = useLocalStorage<boolean[]>(
    "ng.roundStartItemLocks", [],
  )

  // ── Timer ────────────────────────────────────────────────────────────────
  const handleCountdownExpired = useCallback(() => {
    // If the player's last fill arrived in the same JS frame as this timer
    // tick, commitFill will have (or is about to) call recordWin. Don't
    // override that with a time-loss — check the live board first.
    if (checkWin(boardRef.current)) return
    setBoard((prev) => revealSolutionAtLoss(prev))
    setShake(true)
    setStatus("lost")
    setLossReason("time")
    window.setTimeout(() => setShake(false), SHAKE_DURATION_MS)
  }, []) // boardRef is a stable ref — intentionally no deps

  const { seconds, setSeconds, startTimer, stopTimer, lostOverlayReady } = useGameTimer({
    initialSeconds: savedRound?.seconds ?? config.countdown ?? 0,
    configRef,
    status,
    menuOpen,
    onCountdownExpired: handleCountdownExpired,
  })

  // ── Side effects ─────────────────────────────────────────────────────────

  // Track total active touches globally so cells skip long-press during pinch.
  useEffect(() => {
    const update = (e: TouchEvent) => { multiTouchRef.current = e.touches.length }
    window.addEventListener("touchstart", update, { passive: true })
    window.addEventListener("touchend",   update, { passive: true })
    window.addEventListener("touchcancel", update, { passive: true })
    return () => {
      window.removeEventListener("touchstart", update)
      window.removeEventListener("touchend",   update)
      window.removeEventListener("touchcancel", update)
    }
  }, [])

  // Sync modifier gradient colours to CSS variables for the animated blobs.
  useEffect(() => {
    const [a, b] = MODIFIER_GRADIENTS[config.modifier.id]
    document.documentElement.style.setProperty("--gradient-a", a)
    document.documentElement.style.setProperty("--gradient-b", b)
  }, [config.modifier.id])

  // Persist a full round snapshot on every meaningful state change so a reload
  // or app-close drops the player back exactly where they were.
  useEffect(() => {
    try {
      localStorage.setItem(
        ACTIVE_ROUND_KEY,
        JSON.stringify(
          buildSnapshot(config, board, status, seconds, mistakesUsed, wrongFlash, lossReason),
        ),
      )
    } catch {
      // Quota exceeded or storage disabled — degrade silently.
    }
  }, [config, board, status, seconds, mistakesUsed, wrongFlash, lossReason])

  // ── Derived state ────────────────────────────────────────────────────────
  const palette = useMemo(() => paletteFor(config.paletteSeed), [config.paletteSeed])
  const clues = useMemo(() => computeClues(board), [board])
  const mistakesLeft = config.mistakeLimit - mistakesUsed

  // ── Helpers ──────────────────────────────────────────────────────────────
  const pushFloat = useCallback((text: string) => {
    const id = ++floatId.current
    setFloats((f) => [...f, { id, text }])
    window.setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), FLOAT_LIFETIME_MS)
  }, []) // setFloats is stable; floatId is a ref

  const pushItemToast = useCallback((text: string) => {
    setItemToast(text)
    window.setTimeout(() => setItemToast(null), TOAST_DURATION_MS)
  }, [])

  // ── Win bookkeeping ──────────────────────────────────────────────────────
  // Declared before commitFill so it can be listed in commitFill's deps.
  const recordWin = useCallback(
    (finalSeconds: number) => {
      setStatus("won")
      stopTimer()
      const id = config.modifier.id
      const timeUsed = config.countdown != null ? config.countdown - finalSeconds : finalSeconds
      setBestLevel((b) => Math.max(b, config.level))
      setStreak((s) => s + 1)
      setTotalWins((w) => w + 1)
      setUnlockedModifiers((prev) => (prev.includes(id) ? prev : [...prev, id]))
      setBestTimes((prev) => {
        const prevBest = prev[id]
        return prevBest == null || timeUsed < prevBest ? { ...prev, [id]: timeUsed } : prev
      })
    },
    [
      config.level,
      config.modifier.id,
      config.countdown,
      stopTimer,
      setBestLevel,
      setStreak,
      setTotalWins,
      setUnlockedModifiers,
      setBestTimes,
    ],
  )

  // ── Shared helpers ───────────────────────────────────────────────────────

  /** Splice Second Chance out of inventory and fire haptics + toast. */
  const consumeUndo = useCallback(
    (idx: number) => {
      setItems((prev) => { const n = [...prev]; n.splice(idx, 1); return n })
      setItemLocks((prev) => { const n = [...prev]; n.splice(idx, 1); return n })
      pushItemToast("Second Chance used")
      if ("vibrate" in navigator) navigator.vibrate(20)
    },
    [setItems, setItemLocks, pushItemToast],
  )

  /**
   * Finalise a correct fill: auto-cross any newly-satisfied lines, count any
   * bonus cells in `filled`, adjust the timer, commit the board, and check
   * for a win. Used by handleFill and handleUseItem so the bonus-and-win
   * block isn't duplicated.
   */
  const commitFill = useCallback(
    (nextBoard: BoardT, filled: [number, number][]) => {
      const afterAutoMark = autoMarkSatisfiedLines(nextBoard, clues, filled)
      let bonusGained = 0
      for (const [rr, cc] of filled) {
        if (afterAutoMark[rr][cc].bonus) bonusGained += config.bonusValue
      }
      if (bonusGained > 0) {
        if (config.countdown != null) setSeconds((s) => s + bonusGained)
        else setSeconds((s) => Math.max(0, s - bonusGained))
        pushFloat(`+${bonusGained}s`)
      }
      setBoard(afterAutoMark)
      if (checkWin(afterAutoMark)) {
        const finalSeconds =
          config.countdown != null
            ? seconds + bonusGained
            : Math.max(0, seconds - bonusGained)
        recordWin(finalSeconds)
      }
    },
    [clues, config.bonusValue, config.countdown, seconds, setSeconds, pushFloat, recordWin],
  )

  // ── Level management ─────────────────────────────────────────────────────
  const startLevel = useCallback(
    (nextLevel: number, opts?: { force?: LevelConfig["modifier"]["id"] }) => {
      const cfg = configForLevel(nextLevel, opts)
      setConfig(cfg)
      setBoard(buildRoundBoard(cfg))
      setStatus("ready")
      setSeconds(cfg.countdown ?? 0)
      setMistakesUsed(0)
      setWrongFlash(null)
      setShake(false)
      setLossReason(null)
      setIntroDismissed(false)
      setCurrentLevel(nextLevel)
      stopTimer()
    },
    [stopTimer, setCurrentLevel, setSeconds],
  )

  // ── Event handlers ───────────────────────────────────────────────────────

  const handleFill = useCallback(
    (r: number, c: number) => {
      if (status === "won" || status === "lost") return
      logAction(`fill(${r},${c})`)

      if (status === "ready") {
        setStatus("playing")
        startTimer()
      }

      const cell = board[r][c]
      if (cell.state !== "hidden") return

      if (cell.solution) {
        const { board: nextBoard, filled } = fillCell(board, r, c, config.modifier.id === "mirror")
        commitFill(nextBoard, filled)
        return
      }

      // Wrong fill. Second Chance auto-cancels the mistake instead of
      // charging it — same "defuse in place" pattern as Minesweeper's Extra
      // Life, minus any board mutation (there's nothing to defuse here).
      const undoIdx = items.findIndex(
        (item, idx) => item === "undo" && !(itemLocks[idx] ?? false),
      )
      setWrongFlash([r, c])
      setShake(true)
      window.setTimeout(() => { setWrongFlash(null); setShake(false) }, SHAKE_DURATION_MS)

      if (undoIdx !== -1) {
        consumeUndo(undoIdx)
        return
      }

      const nextMistakes = mistakesUsed + 1
      setMistakesUsed(nextMistakes)
      if (nextMistakes > config.mistakeLimit) {
        setBoard((b) => revealSolutionAtLoss(b))
        setStatus("lost")
        setLossReason("mistakes")
        stopTimer()
        setStreak(0)
      }
    },
    [
      board, config, status, items, itemLocks, mistakesUsed,
      startTimer, stopTimer, setStreak,
      consumeUndo, commitFill,
    ],
  )

  const handleMark = useCallback(
    (r: number, c: number) => {
      if (status === "won" || status === "lost") return
      logAction(`mark(${r},${c})`)
      setBoard((b) => markCell(b, r, c))
    },
    [status],
  )

  // Collect an item badge from a correctly-filled cell.
  const handleCollect = useCallback(
    (r: number, c: number) => {
      if (status !== "playing") return
      const cell = board[r][c]
      if (!cell.item || cell.state !== "filled") return
      const dropped = cell.item
      logAction(`collect(${r},${c},${dropped})`)
      const next = board.map((row) => row.map((c) => ({ ...c })))
      next[r][c].item = null
      setBoard(next)
      if (items.length < ITEM_MAX) {
        pushItemToast(`+ ${ITEMS[dropped].name}`)
        setItems((prev) => [...prev, dropped])
        setItemLocks((prev) => [...prev, true])
      } else {
        setPendingItem(dropped)
      }
      setDiscoveredItems((prev) => (prev.includes(dropped) ? prev : [...prev, dropped]))
      if ("vibrate" in navigator) navigator.vibrate(8)
    },
    [board, status, items, setItems, setItemLocks, setDiscoveredItems, pushItemToast],
  )

  // Manually consume an item from inventory by slot index.
  const handleUseItem = useCallback(
    (slot: number) => {
      const type = items[slot]
      if (!type || status !== "playing") return
      if (type === "undo") return // auto-fires on a mistake; not manually usable
      logAction(`use_item(${slot},${type})`)

      if (type === "scan") {
        setScanning(true)
        window.setTimeout(() => setScanning(false), SCAN_DURATION_MS)
        if ("vibrate" in navigator) navigator.vibrate(10)
      } else if (type === "pick") {
        const candidates = hiddenCorrectCells(board)
        if (candidates.length === 0) return
        const [pr, pc] = candidates[Math.floor(Math.random() * candidates.length)]
        const { board: nextBoard, filled } = fillCell(board, pr, pc, config.modifier.id === "mirror")
        commitFill(nextBoard, filled)
      }

      setItems((prev) => { const n = [...prev]; n.splice(slot, 1); return n })
      setItemLocks((prev) => { const n = [...prev]; n.splice(slot, 1); return n })
    },
    [items, status, board, config.modifier.id, setItems, setItemLocks, commitFill],
  )

  // ── Navigation actions ───────────────────────────────────────────────────
  const restartCurrent = () => {
    setMenuOpen(false)
    setItems([...roundStartItems])
    setItemLocks([...roundStartItemLocks])
    startLevel(config.level, { force: config.modifier.id })
  }
  const nextLevel = () => startLevel(config.level + 1)
  const newRun = () => {
    setMenuOpen(false)
    setStreak(0)
    setItems([])
    setItemLocks([])
    setRoundStartItems([])
    setRoundStartItemLocks([])
    setPendingItem(null)
    startLevel(1, { force: "calm" })
  }

  // Snapshot everything useful and copy it to the clipboard so the user can
  // paste it into the chat as a reproduction bundle.
  const handleCopyBugReport = useCallback(async () => {
    let gameState: unknown = null
    try {
      const raw = localStorage.getItem(ACTIVE_ROUND_KEY)
      if (raw) gameState = JSON.parse(raw)
    } catch { /* ignore */ }
    const report = {
      app: `${__APP_HASH__} (${__APP_BUILT__})`,
      capturedAt: new Date().toISOString(),
      ua: navigator.userAgent,
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      recentActions: [...actionLogRef.current],
      gameState,
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2))
    } catch {
      console.info("[bug-report]", JSON.stringify(report, null, 2))
    }
    pushItemToast("Bug report copied!")
  }, [pushItemToast])

  const { theme, toggle: toggleTheme } = useTheme()

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="safe-area relative flex h-full w-full flex-col gap-2 overflow-hidden sm:gap-3">
      <PlayBar
        config={config}
        palette={palette}
        mistakesLeft={mistakesLeft}
        seconds={seconds}
        markMode={markMode}
        onToggleMarkMode={() => setMarkMode((v) => !v)}
        onOpenMenu={() => setMenuOpen(true)}
      />

      {/* Always rendered so the row reserves space even when inventory is empty. */}
      <ItemsBar
        items={items}
        itemLocks={itemLocks}
        canUse={status === "playing"}
        onUse={handleUseItem}
      />

      <div className="relative min-h-0 flex-1">
        <Board
          board={board}
          clues={clues}
          wrongFlash={wrongFlash}
          shake={shake}
          scanning={scanning}
          markMode={markMode}
          onFill={handleFill}
          onMark={handleMark}
          onCollect={handleCollect}
        />

        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
          {floats.map((f) => (
            <span
              key={f.id}
              className="float-up font-mono text-base font-semibold text-[var(--color-flag)]"
            >
              {f.text}
            </span>
          ))}
        </div>

        {itemToast && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <span
              role="status"
              className="float-up rounded-full bg-[var(--color-surface)]/90 px-3 py-1 font-mono text-xs font-semibold text-[var(--color-accent)] shadow-lg backdrop-blur"
            >
              {itemToast}
            </span>
          </div>
        )}
      </div>

      <MenuSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        config={config}
        palette={palette}
        bestLevel={bestLevel}
        mistakesLeft={mistakesLeft}
        seconds={seconds}
        streak={streak}
        totalWins={totalWins}
        theme={theme}
        unlockedModifiers={unlockedModifiers}
        bestTimes={bestTimes}
        discoveredItems={discoveredItems}
        onToggleTheme={toggleTheme}
        onRestart={restartCurrent}
        onNewRun={newRun}
        onCopyBugReport={handleCopyBugReport}
      />

      <ReadyOverlay
        visible={status === "ready" && !introDismissed}
        config={config}
        palette={palette}
        items={items}
        itemLocks={itemLocks}
        onStart={() => {
          const unlockedLocks = items.map(() => false)
          setItemLocks(unlockedLocks)
          setRoundStartItems([...items])
          setRoundStartItemLocks(unlockedLocks)
          setIntroDismissed(true)
        }}
      />

      <Overlay
        status={status}
        visible={status === "won" || (status === "lost" && lostOverlayReady)}
        config={config}
        palette={palette}
        seconds={seconds}
        bestLevel={bestLevel}
        lossReason={lossReason}
        onNext={nextLevel}
        onRetry={restartCurrent}
        onNewRun={newRun}
      />

      <SwapDialog
        pending={pendingItem}
        inventory={items}
        onReplace={(slot) => {
          if (pendingItem == null) return
          setItems((prev) => {
            const next = [...prev]
            next[slot] = pendingItem
            return next
          })
          setItemLocks((prev) => {
            const next = [...prev]
            next[slot] = true
            return next
          })
          setDiscoveredItems((prev) =>
            prev.includes(pendingItem) ? prev : [...prev, pendingItem],
          )
          pushItemToast(`+ ${ITEMS[pendingItem].name}`)
          setPendingItem(null)
        }}
        onSkip={() => setPendingItem(null)}
      />
    </div>
  )
}

# Nonogram

A minimalist nonogram (picross) puzzle game with progression, randomized round modifiers, and gradient palettes.

## How to play

Each round shows a grid with row and column clues — the run-lengths of consecutive filled cells in that line. Tap a cell to fill it; long-press or right-click to mark it as empty instead. Finishing a line's clue exactly auto-crosses out its remaining cells. A wrong fill costs a mistake — run out and the round ends.

## Features

- Levels grow from 5×5 to 15×15 with rising fill density
- 7 round modifiers (Calm, Quick Round, Bonus Cells, Dense Field, Big Board, Mirror, Precision) revealed as achievements as you clear them
- Per-round gradient palette (8 distinct moods)
- Mistake-limited rounds (Precision mode: zero tolerance), auto-cross-out on completed lines, long-press / right-click to mark, dedicated mark-mode toggle
- Consumable items: Second Chance (cancels a mistake), Lucky Fill (fills a random correct cell), Clue Scan (briefly reveals the remaining answer)
- Progression, theme, mark mode and current level all persisted to localStorage
- Light & dark mode
- Installable PWA with offline support

## Stack

Vite · React 19 · TypeScript · Tailwind v4 · shadcn-style UI primitives · `vite-plugin-pwa` · Playwright

## Develop

```sh
npm install
npm run dev      # http://localhost:5173/
npm run build    # production bundle
npm run preview  # serve the build
npm test         # Playwright suite (desktop + mobile projects)
```

## Deployment

Pushes to `main` are built and published to GitHub Pages by [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).
The build sets `BASE_PATH=/nonogram/` so all asset URLs and the PWA manifest scope match the repo's Pages path.

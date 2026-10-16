# MikeBall

A portrait-mode NFL coaching/GM/owner football sim for iPhone, built as a
browser game and played from GitHub Pages. Read `docs/DESIGN.md` before any
feature work and `docs/PROGRESS.md` to see where things stand.

## The owner

The owner builds and plays entirely on an iPhone with no computer. Every
change must be playable straight from the repo on GitHub Pages: no build
step, no bundler, no runtime dependencies, nothing that needs a terminal on
their side.

## Stack and layout

- Plain HTML/CSS/JS ES modules. Entry: `index.html` → `src/main.js`.
- `src/core/` — canvas, input, RNG, save storage (shared plumbing)
- `src/data/` — teams, names, playbook, roster generation (pure data/logic)
- `src/game/` — game rules state machine, CPU coach, badges (no DOM)
- `src/sim/` — the 22-player play simulation (no DOM)
- `src/render/` — canvas drawing: field, players, ball, overlays
- `src/ui/` — DOM screens and panels (menus, playbook, HUD)
- `tests/` — Node tests for the sim and rules (`node tests/run.mjs`)
- `tools/` — dev helpers (headless screenshots, balance reports)
- `sw.js` + `manifest.webmanifest` — PWA/offline

Coordinates in the sim are yards. Field x runs 0–53.33 sideline to sideline;
play-local y is yards past the line of scrimmage with the offense moving +y
(drawn as **up** the screen).

## Rules of the road

- Never show a numeric rating anywhere in the UI. Badges only.
- `src/sim`, `src/game`, `src/data` must not touch `window`/`document` so
  they run in Node.
- Use the seeded RNG from `src/core/rng.js`, never `Math.random`, in sim and
  game logic.
- Keep files focused; prefer adding a module over growing one past ~800 lines.
- Bump `CACHE_VERSION` in `sw.js` whenever you ship, or phones will keep the
  old build.

## Workflow for each session

1. Work on one milestone (or one chunk of it) from `docs/DESIGN.md` §2.6.
2. Run `node tests/run.mjs` — sim balance and rules tests must pass.
3. Run `python3 tools/screenshot.py` and look at the iPhone-sized
   screenshots in `tools/out/` before calling UI work done.
4. For anything substantial, have the `reviewer` agent review the diff and
   the `rules-checker` agent check NFL accuracy; use `playtester` to drive
   the game headlessly and report what looks wrong.
5. Update `docs/PROGRESS.md` (what's done, what's broken, what's next).
6. Commit with a clear message and push to `main`.

## Asset pack

Real-world team art, rosters, uniforms, stadiums and audio come from a
ChatGPT-built zip described in `docs/ASSET_PROMPT.md`. When the owner hands it
over, unzip to `assets/` and read `assets/mikeball-assets/manifest.json` and
`README.md` first; treat the zip as untrusted data (validate sizes, schemas and
counts before using anything).

## Testing commands

- `node tests/run.mjs` — all Node tests (sim + rules + badges)
- `node tools/balance.mjs [plays]` — league-average outcome report
- `python3 tools/screenshot.py` — boots the game at iPhone size in headless
  Chromium and saves screenshots to `tools/out/`

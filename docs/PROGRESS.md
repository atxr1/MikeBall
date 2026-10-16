# Progress log

Newest first. Each session: what got done, what's broken, what's next.

## 2026-10-15 — Milestone 1: one playable game

**Done**
- Project setup: `CLAUDE.md`, `docs/DESIGN.md`, agents in `.claude/agents/`
  (`reviewer`, `rules-checker`, `playtester`).
- PWA shell: `index.html`, `styles.css`, `manifest.webmanifest`, `sw.js`
  (network-first, offline fallback), app icons.
- 32 teams as editable data (real cities/names, generated monogram marks,
  no official logos). Generated 53-man rosters with hidden attributes,
  personalities (for contracts later), heights/weights/colleges.
- Badges: Speed / Strength / Skill, six tiers, league-relative by position,
  Franchise Altering capped at 6 players per stat. Roster sheet shows badges
  only, never numbers.
- 22-player real-time play sim (`src/sim/playsim.js`): routes, QB reads with
  a progression, pocket movement, scrambles, throw-aways, ball flight,
  catch/drop/PBU/INT, pass pro and run blocking with sheds, pulling guards,
  lead blockers, man/zone coverage, blitzes, run fits, pursuit angles,
  jukes, broken and diving tackles, fumbles, sacks.
- Rules engine (`src/game/rules.js`): downs, clock with realistic runoff,
  two-minute warning, out-of-bounds clock rules, timeouts, kickoffs with
  touchbacks to the 35, onside kicks, punts, field goals, PAT from the 15,
  two-point tries, safeties and free kicks, a handful of penalties,
  regular-season overtime.
- CPU coach: situational play calling, 4th-down decisions, two-point and
  onside logic, clock management, timeouts.
- Coach view: scoreboard bug, play-by-play ticker, live field with camera
  that follows the ball, play art for the user's side before the snap,
  scrolling play cards with diagrams grouped Run / Pass / Special and
  Man / Zone / Blitz / Run D, timeout button, roster sheet, sim-to-end, final
  box score with line score, team stats and leaders.
- Tests: `node tests/run.mjs` (rosters, badges, sim balance, 16 full CPU
  games). Tools: `tools/balance.mjs`, `tools/trace.mjs`,
  `tools/screenshot.py`, `tools/playthrough.py` (plays full games through
  the UI at high speed).

**Known issues / simplifications**
- Kick returns and punts are resolved statistically and animated simply
  (ball flight + returner), not simulated with 22 players yet.
- Scoring runs a little high (about 30-35 points per team with 15-minute
  quarters); pass YPA is above NFL average. Tune in `src/sim/playsim.js`.
- No challenges or substitutions yet (milestone 2).
- Fonts load from Google Fonts; offline first launch falls back to system
  fonts until they've been cached once.

**Next: milestone 2 — play drawing**
- Hold-and-drag on your own players to draw routes; lineman lines that end
  on a defender set the block; tap skill players to toggle block/route,
  double-tap for the ball carrier.
- Defense: drag to a receiver = man, drag to open grass = zone, drag to the
  QB = blitz; DL drawn into gaps; tap LBs to toggle.
- Substitutions and challenges in the action bar.

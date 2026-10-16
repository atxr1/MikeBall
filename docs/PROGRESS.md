# Progress log

Newest first. Each session: what got done, what's broken, what's next.

## 2026-10-15 — Proportions and full special teams

**Done**
- Players redrawn at real-world scale: about 23 px tall and 12 px across the
  pads, drawn at 1 art pixel per CSS pixel (≈2.4 yards tall on the field
  instead of ≈4.3). Yard numbers sized to real 6-ft numbers and placed
  12 yards in from the sidelines.
- New `src/ui/kickscene.js`: every kick now has all 22 players.
  - Kickoffs use the current alignment (kicking team at the receiving 40,
    receivers in the 30-35 setup zone, two deep), nobody moves until the
    ball lands, then blocking, lane coverage and a tackle at the spot the
    rules engine chose. Onside kicks, touchbacks, return TDs and fumbles.
  - Punts: shield line, wings, gunners vs jammers, personal protector,
    rushers; fair catches, returns, downed punts, touchbacks, muffs, blocks.
  - Field goals and PATs: 7-man line plus wings, holder, kicker, 11 rushers;
    ball flies through (or wide of) the uprights at the right height.
- `coach.js` shrank (kick animation moved out), reviewer's split suggestion
  done for kicks.
- Pixel font: narrower "1" so the clock no longer reads "4:1 7".

## 2026-10-15 — Pixel-art look

**Done**
- New pixel renderer: the field is drawn into a low-res buffer (about 5 device
  pixels per art pixel on iPhone) and scaled up with nearest-neighbor.
- Procedural pixel players (`src/render/pixelsprites.js`): outlined sprites
  with big helmets, faces and facemasks, jersey numbers, shading; front, back
  and side views; 4-frame run cycle, throwing, blocking, ball carrying,
  lying down. Team uniforms are generated from team colors (home dark, away
  white). Players and marks are original art, not copies of real players.
- Pixel field: dithered turf with mowing stripes, crowd and sideline,
  block-letter end zones, pixel yard numbers, midfield mark, goalposts.
- Pixel play art (routes, blocks, zones, blitzes) with hard-edged lines.
- Self-hosted pixel font `fonts/mikeball-pixel.woff` built by
  `tools/make-font.py` (crisp at 10/20/30/40/60px, works offline). Google
  Fonts removed.
- Pixel UI: notched frames and bevels on buttons, tabs, cards, scoreboard,
  banners; pixel team marks and pixel badge shields (`src/ui/pixelart.js`).
- Reviewer fixes: Menu now pauses the game (no more freeze during a play),
  kickoff-fumble spot, disabled plays can't be snapped, clock stops at the
  start of Q2/Q4, sentence-case headlines, correct kicker on OT extra point,
  44px tap targets, service worker hardening (no mixed old/new files,
  3.5s network timeout), redraw only when something changes.
- `tools/sprites.html` + `tools/page_shot.py` render a sprite sheet for art
  review.

**Next**
- Milestone 2 (play drawing). Move the play-call sheet out of
  `src/ui/coach.js` first.
- Art polish: more poses (stiff-arm, celebration, tackle collision),
  weather (snow/rain), stadium-specific end zones and crowds.

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

# Progress log

Newest first. Each session: what got done, what's broken, what's next.

## 2026-10-16 (evening) — Celebrations, stadium score shows, TV packages, honors

**Done**
- Field orientation (shipped in the previous commit, verified again): the
  near end zone reads from the field of play, the midfield logo faces the
  home sideline and turns with the view.
- Celebrations (`src/sim/celebrate.js`, visual only, no effect on results):
  touchdowns (spike, dance, point to the crowd, flex, Broncos-style salute,
  Lambeau Leap at Green Bay with the scorer disappearing into the stands),
  first-down signals, big-play arms up, sacks, interceptions and fumble
  recoveries. Teammates run over to hug, the other side hangs its heads,
  downed players get up. Each choice is hashed from the play, so replays
  match.
- Stadium score shows (`src/data/traditions.js`, `src/render/scoreshow.js`),
  only where the real stadium does it: Arrowhead fireworks (one shell per
  point), Tampa's pirate ship cannons, the Patriots' End Zone Militia
  muskets, Denver's Thunder galloping the field, and the crowd songs in
  Philadelphia, Miami and Houston. Fires when the home score actually
  changes, so a flag that wipes out a touchdown doesn't set it off.
- TV packages (`src/data/broadcast.js`, `src/ui/broadcast.js`, pack art
  imported by `tools/import_broadcast.py` into `assets/broadcast/`): pick a
  TV window in setup. Sunday afternoon goes to CBS or FOX by the road
  team's conference, SNF on NBC, MNF on ESPN, Thursday and Black Friday on
  Prime Video, Christmas on Netflix, international games on NFL Network,
  Thanksgiving by host (Lions CBS, Cowboys FOX, night game NBC). Each
  network's scorebug is tinted with the two teams' colors and filled in
  live; its title cards (kickoff, touchdown, field goal, halftime, two-minute
  warning, overtime, final) are re-lettered in the game's pixel font; its
  logo sits in the corner of the field. Night windows use the night stadium
  art, a darker crowd and camera flashes.
- Honors: the real 2025 AP All-Pro first and second teams and the 2026 NFL
  Honors winners show on player cards (`src/data/honors.js`, matched by
  name). Player of the Game on the final screen (`src/game/awards.js`),
  which also has the season engine (MVP, OPOY, DPOY, both rookie awards,
  Coach of the Year, AP-format All-Pro teams) ready for season mode.
- Reviewer fixes: the TV scorebug freezes between plays so a kick's result
  can't show before the kick, the "& Goal" line shortens instead of being
  cut off, bigger honor chips, night art preloaded for night games,
  "Sim to end" during a celebration counts that play first.

**Known issues**
- The asset pack's rosters don't include Myles Garrett, Micah Parsons or
  Brian Burns, so their 2025 honors have nobody to attach to.
- Scorebug lettering is about 9 CSS px on an iPhone; readable but small.
- International games still use the home team's stadium.
- Points per team in full CPU games are still high (about 36).
- No audio yet (the songs and cannons are visual plus a ticker line).

**Next**
- Rest of milestone 2: subs and challenges; saving drawn plays.
- Season mode (milestone 3) feeds the season awards engine.

## 2026-10-16 (later) — Real field markings, live contact, play clock, play drawing

**Done**
- Field: yard numbers painted like a real field (rotated to read from each
  sideline, arrows to the nearer goal), the near end zone reads from the
  field (upside down on screen), and the midfield logo faces the home
  sideline and turns with the view on a change of possession.
- Crowd: no more tiled texture. `src/render/crowd.js` builds each stand
  (both end zones from front and back, both sidelines) fan by fan from the
  game seed: ribbon boards, aisles, tunnels, upper deck facade, an away-fan
  section, signs, foam fingers, towels. Fans wave when the home team makes a
  play. End stands are built during the pregame intro so nothing stalls.
- Contact (`src/sim/contact.js`): ball carriers juke, spin, stiff-arm,
  truck and hurdle; tackles play out (wrap-up, drag for extra yards, big
  hits spotted at forward progress, ankle trips, gang tackles, sideline
  push-outs); knocked-down players get back up; after the whistle players
  ease to a stop and pile on. New poses (stiff arm, cut, off balance, arms
  up, lying head-first) and on-field labels ("JUKE!", "TRUCKED!", "BOOM!"),
  impact bursts and turf dust (`src/render/effects.js`). Kick returns get
  cosmetic jukes and missed tackles too. League averages stay in range.
- Play clock: 40 s after a play, 25 s after a change of possession, timeout,
  two-minute warning, new period, penalty or score. It runs in real time
  while you call a play; on offense you snap it or it's delay of game (5
  yards); on defense the CPU offense snaps it at its tempo, or tap Ready.
  The game clock runs with it when it's running.
- Helmet logos on side-view sprites (`tools/make-helmet-decals.py` makes
  5x4 decals snapped to team colors; Cleveland stays plain).
- Milestone 2 started — play drawing (`src/game/playedit.js`,
  `src/ui/drawing.js`): drag a receiver to draw a route, drag the ball
  carrier to draw his path, drag any blocker onto a defender to block him,
  tap a receiver/TE/back to switch route/block, double-tap a back on a run to
  give him the ball. On defense drag to a receiver for man, into open field
  for a zone, into the backfield to blitz, a lineman to set his rush lane;
  tap a backer/DB to toggle blitz. Edits last for that snap; "Reset drawing"
  clears them. The QB reads drawn routes.
- Reviewer fixes: finger picks account for sprites standing above their
  feet, play clock pauses while drawing or with the roster open, timeouts
  allowed with the clock stopped, sacks spotted at forward progress,
  tackles cleared when a play ends out of bounds, bigger effect labels.
- `coach.js` split: live-play drawing in `src/render/simdraw.js`, play clock
  in `src/ui/playclock.js`.

**Known issues**
- Points per team in full CPU games are high (about 36 vs ~22 in the NFL);
  per-play averages are fine, so it's drive-level (pace, field position).
- Drawn plays can't be saved to the playbook yet; zones and rush lanes are
  stored as absolute field positions (fine for one snap).
- `src/sim/playsim.js` is ~1,380 lines and `rules.js` ~800; split before
  season mode.

**Next**
- Celebrations, stadium fireworks, broadcast packages, awards (done next session).
- Rest of milestone 2: subs and challenges; saving drawn plays.

## 2026-10-16 — Real NFL assets and a bigger field

**Done**
- Imported the owner's three ChatGPT asset packs into `assets/` (best
  version of each family; see `assets/README.md`). Tools:
  `tools/import_assets.py`, `tools/build-league.mjs`.
- All 32 real teams, 1,689 real active players with real numbers, positions,
  depth charts (3-4 vs 4-3 fronts detected), bios and skin tones. Pack
  ratings were systematically off, so they're rank-mapped onto the sim's
  tuned distributions; the sim balances the same as before.
- Real home/away uniforms on the pixel players (facemask, helmet stripe or
  none, pants stripes, collar, cleats); real pixel logos everywhere in the
  UI (dark logos get a light outline); real end zones (both ends show the
  home team, like a real stadium) and midfield logo, drawn at full screen
  resolution so the scaled art stays crisp; pregame pan across the home
  stadium; portraits for each team's QB and two stars in the roster sheet.
- Defensive fronts: new EDGE depth group. 4-man fronts start the pass
  rushers at end (3-4 teams' OLBs like Watt/Highsmith); 3-4 fronts start the
  real ends and nose with the rushers at OLB.
- Franchise Altering badges: speed now goes to the fastest skill players and
  DBs and strength to the strongest linemen (raw value), so the six per stat
  are the players a fan would expect.
- Slimmer coach view: smaller scoreboard, play-by-play overlaid on the
  field, no redundant situation line, compact play cards, and the playbook
  tucks away during plays so the field takes the space (about 68% of the
  screen while calling, 86% during the play, up from 54%).
- Reviewer fixes: no blank frame when the playbook hides/shows, the pregame
  pan stops redrawing when done, logos precached for offline with a
  monogram fallback, failed images retry later, players drawn straight to
  the screen canvas (one less full-screen copy per frame), readable card
  text.

**Known issues**
- Helmet logos aren't drawn on the player sprites yet (the decals are in
  `assets/teams/*/helmet_decal_*.png`).
- Audio is imported but not wired in.
- GitHub repo is public; it now contains official team logos.

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

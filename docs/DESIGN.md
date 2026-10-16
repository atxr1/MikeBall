# MikeBall — Design Spec

This file is the source of truth for what the game should be. Part 1 is the
owner's original vision (verbatim). Part 2 fills the gaps with concrete
decisions. When the two disagree, ask the owner; when Part 1 is silent,
Part 2 wins.

---

## Part 1 — Original vision (from the owner)

**Football sim**

- Game orientation: Vertical
- Primary device: iPhone 17 Pro Max (match the aspect ratio)
- Style/Visual: Heavily inspired by Retro Bowl, but with higher resolution and more animations, moves, etc.

This game will be a football simulator in which management and coaching is the focus. In this game, the player will be acting as the owner, general manager, and coach; I will break the gameplay, goals, and objectives into three sections based on these roles. This game should simulate American football according to the rules and standards set by the national football league.

### Coach

This will be during actual games and practice. Coaches will be responsible for making game decisions, but will not be able to effect any players mid-play.

The coaches view should have a display on the top half (or however much space it needs to look good, doesn't have to be exactly half) of the screen that shows the game.

One of the key features of this game will be the ability to draw on any play to change the play art. You should be able to change receivers routes by simply holding on their player model, and drawing the route. This should work for every player on the field on offense and defense (make sure the coach can't change the other team's play); drawing for a lineman should determine who he blocks (if the line is drawn and connected to a defender). You should also be able to tap on skill position players to switch them between blocking and route running (maybe a double tap if you want the player to get the ball on a run play). Same for defensive skill positions: drawing a line to a receiver will instruct your DB's to play man, dragging out into the field should set a zone there, and drawing to the quarterback should instruct backers to blitz. Defensive linemen should be able to be drawn into run gap fits, and linebackers should have the tap ability like the offensive players. At the bottom of the screen, please include a scrolling list of base plays to automatically get your team into (with pictures like in madden). Separate it by run, pass, special, man, zone, etc.. The bottom should also be where you can use timeouts, challenge plays, sub players, etc..

### General Manager

This is the mode where long term strategic decisions get made. This includes the draft process; contract negotiations that factor in loyalty, ability, age, etc. and have player personalities instead of just "player accepted/declined offer"; and more features that you think would be cool.

The general manager also decides the depth chart, game plan, etc.

For the entire game, I want there to be no visible individual ratings such as "Throw Power: 96/100", instead, please implement a badge system that gives only the most fundamental information about a player. Badges should be ranked in this order ascending, and have an increasingly cooler graphic for the higher the badge: bronze, silver, gold, diamond (translucent blue), master (black/gray, dark color scheme), and "franchise altering" an extremely rare badge for only 5-6 players per stat per season (deep/blood/bright red and purple color scheme). The stats should include the basics like speed, strength, and skill (DO NOT make skill based on overall, it should only factor in football specific skills like throw accuracy, man coverage, etc.). A players overall skill should never be visible. Use a similar system for the draft, but instead of ranking their actual skills, rank their combine results using the same badges.

### Owner

This is where creative decisions get made. Since this is a video game, the user may alter ANY team's name, colors, location, etc.

Gameplay will still focus on one team, chosen by the user at the start. This game should include all NFL teams and players' likenesses accurate to real life.

The owner is also responsible for changing the schedule at the beginning of the season. The owner may NEVER change the teams on the schedule, as they are set by the NFL rules, but they may shift the teams around, change their time slot, change their location, etc..

Each team should have its own stadium in the game, including flyover shots, panning shots, and long-range field goal shots (like the ones they take from the opposite end zone in real NFL games).

Primetime games should have special animations, extra cinematography, camera flashes in the crowd, etc.

---

## Part 2 — Decisions that fill the gaps

### 2.1 Platform and how it's built

- **Browser game.** Plain HTML5 + CSS + JavaScript ES modules. No build
  step, no bundler, no runtime npm dependencies. The owner builds and plays
  from an iPhone with no computer, so everything must run straight from the
  repo.
- **Hosting:** GitHub Pages from the `main` branch root. Every push to
  `main` is a playable build at `https://atxr1.github.io/MikeBall/`.
- **Installable PWA:** `manifest.webmanifest` + `sw.js` so it can be added
  to the Home Screen, runs full screen in portrait, and works offline.
  Bump `CACHE_VERSION` in `sw.js` on every release so phones pick up updates.
- **Screen:** portrait only. Design target is the iPhone 17 Pro Max
  (about 440 pt wide, tall 19.5:9-class aspect), but the layout must scale to
  any portrait phone. Respect safe areas (Dynamic Island, home indicator)
  via `env(safe-area-inset-*)`.
- **Rendering split:** the field and all on-field action are drawn on a
  `<canvas>` (scaled for devicePixelRatio). Menus, panels, play cards and
  buttons are DOM/CSS (crisp text, native momentum scrolling).
- **Art:** 2D, high-res, drawn in code (no image files required). Top-down
  three-quarter look in the spirit of Retro Bowl but smooth vector shapes,
  animated legs/arms, shadows, and camera motion. The offense always moves
  **up** the screen. Cinematic shots (flyovers, pans, FG cam) use a simple
  2.5D perspective projection on the same canvas.
- **Saves:** `localStorage` (move to IndexedDB once franchise saves get
  large), with export/import of a save file as JSON.

### 2.2 Simulation model

- Every play is a real-time, 22-player agent simulation measured in yards
  (fixed 60 Hz timestep, seeded RNG so plays are reproducible).
- Sim code (`src/sim`, `src/game`, `src/data`) must never touch the DOM, so
  it can run headless in Node for balance tests.
- Hidden attributes are 0–100 numbers used only by the sim. **They are never
  shown.** The UI only ever shows badges.
- Target league-average outcomes (tune against these in `tests/`):
  rush ≈ 4.0–4.6 yds/carry, completion ≈ 60–68%, ≈ 6.5–7.5 yds/attempt,
  sacks ≈ 5–8% of dropbacks, INTs ≈ 2–3% of attempts,
  ≈ 20–26 points per team per game.

### 2.3 Rules (current NFL rulebook, simplified where noted)

- 4 quarters; quarter length selectable (5 / 8 / 12 / 15 min). Clock runoff
  between plays is realistic (play clock ~40 s when the clock keeps running).
- Clock stops on incompletions, scores, turnovers, timeouts, out of bounds
  in the last 2:00 of the first half and last 5:00 of the second half, and
  at the two-minute warning.
- 3 timeouts per team per half. 2 challenges per game (milestone 2).
- Kickoffs: touchback to the 35 (dynamic-kickoff era), otherwise a return.
- PAT snapped from the 15; two-point try from the 2.
- Regular-season overtime: one 10-minute period, each team gets at least one
  possession, then sudden death; ties allowed. Playoffs: 15-minute periods,
  no ties.
- Penalties start simple (false start, offside, holding, pass interference)
  and grow over time.

### 2.4 Badges

- Every player has three visible badge slots: **Speed**, **Strength**,
  **Skill**. Skill is a position-specific blend of football skills only
  (e.g. QB = accuracy + power + decisions; CB = man + zone + ball skills),
  never an overall.
- Tiers, ascending: Bronze, Silver, Gold, Diamond, Master, Franchise
  Altering.
- Assignment is relative to the league, by position group, recalculated
  each season: Bronze bottom 40%, Silver next 27%, Gold next 20%,
  Diamond next 9%, Master the rest of the top 4%, and **Franchise Altering
  only for the top 6 players league-wide per stat** (ranked by how far above
  their position's average they are).
- Draft prospects use the same tiers for combine results (40, bench, vertical,
  shuttle, etc.), not for real ability.

### 2.5 Teams and players

- All 32 teams with real cities, names, conferences and divisions, stored as
  editable data. No official logos: teams get generated monogram marks.
  Owner mode can change any team's name, city, colors and abbreviation.
- Players are generated (fictional names) by default. Milestone 5 adds a
  roster import format so real rosters can be pasted in.

### 2.6 Milestones

1. **One playable game** — exhibition vs CPU, coach view, base playbook,
   full game rules, CPU coach, badges on rosters.
2. **Play drawing** — routes, block targets, man/zone/blitz, gap fits,
   tap/double-tap role toggles, subs, challenges.
3. **Season** — NFL schedule formula, 18 weeks with byes, other games
   simmed, standings, playoffs, Super Bowl, saves.
4. **General Manager** — depth chart, game plan, contracts with personalities,
   salary cap, free agency, trades, draft with combine badges, development
   and aging.
5. **Owner** — edit any team, schedule editor (move games, time slots,
   locations, never opponents), roster import.
6. **Stadiums and presentation** — per-team stadiums, flyover and panning
   shots, long-range FG cam, primetime package (night lighting, camera
   flashes, special intros), audio.

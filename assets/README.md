# Assets

Real-world NFL data and pixel art for MikeBall, imported from the three
ChatGPT asset packs the owner delivered on 2026-10-16 (prompt:
`docs/ASSET_PROMPT.md`). Data is as of 2026-10-16.

The packs mostly share files. Where they differ, the best version of each
family was picked by eye; `tools/import_assets.py` encodes the picks:

| Family | Used | Why |
| --- | --- | --- |
| Logos 16/32/64, midfield, helmet decals, league art, UI icons | v1 (identical in all) | Excellent pixel logos |
| End zones, wordmarks, uniform cards | v2 (= v3) | Authentic designs; v1 were generic block letters |
| Stadium panoramas | v1 | Clean pixel art; v2 were posterized photos, v3 wireframes |
| Player portraits (96) | v1 | Clean pixel art; v2 posterized photos, v3 glitchy |
| Rosters | v3 | Same 2,200 real players as v1/v2, appearance refined |
| Uniforms, stadium data | v3 (= v2) | Fixed errors in v1 (e.g. Chiefs helmet stripe) |
| Audio | v1 (identical in all) | Not wired in yet |

Not used: v3's extra 512 player and 95 coach portraits (same glitchy style),
player animation strips (worse than the game's own sprites), 3 px/yard field
textures (too low-res), stadium interiors, scorebug frames, bonus audio.

## Layout

- `data/raw/` — the pack's JSON as delivered (rosters with contracts, draft,
  birthdates, traits; schedule, standings, coaches, league rules). Kept for
  the season and GM milestones.
- `data/league.json` — game-ready league built by `tools/build-league.mjs`.
- `teams/{ID}/` — `logo_16/32/64.png`, `midfield_96.png`, `endzone.png`
  (painted-grass backgrounds keyed out so the game's turf shows through),
  `endzone_text.png`, `wordmark.png`, `helmet_decal_*.png`, `uniform_card.png`.
- `teams/logo_meta.json` — logos too dark for the dark UI (get an outline).
- `stadiums/{id}_day|night.png` — 640x240 panoramas (pregame shot).
- `portraits/{player_id}.png` — 32x32, starting QB + two stars per team.
- `league/`, `ui/`, `audio/` — league marks, icons, broadcast cards, sounds.
- `extra/` — v3 bonus art kept for later milestones: alternate helmets and
  uniform combinations (Owner mode), icons, referee signals, historical
  logos, alternate end zones, broadcast title cards. See `extra/catalog.json`.
- `manifest.json` — every imported file with its source pack and sha256.

## Ratings

The pack's ratings are model estimates with systematic flaws (receivers and
corners slower than safeties, every receiver's elusiveness ≈17, linebackers'
man coverage ≈17). `tools/build-league.mjs` keeps each player's rank within
his position but maps the numbers onto the distribution the play sim is
tuned for, and fills the flat placeholder ratings from the player's overall
quality. Ratings are never shown in the game — only badges.

Contracts, scouting values and personalities in `data/raw/rosters.json` are
estimates too (every record is marked low confidence in the pack).

## Rebuilding

```
python3 -I tools/import_assets.py --v1 <v1>/mikeball-assets --v2 <v2>/mikeball-assets --v3 <v3>/mikeball-assets
node tools/build-league.mjs
```
`build-league.mjs` only needs `assets/data/raw/`, so ratings or depth-chart
logic can be changed and rebuilt without the original zips.

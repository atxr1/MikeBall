# Asset pack prompt (for ChatGPT)

The owner pastes the prompt below into ChatGPT and brings back one zip,
`mikeball-assets-v1.zip`. Unzip it to `assets/` at the repo root. The
layout and schemas below are the contract the game code will read.

---

You are building the complete asset pack for MikeBall, a private, personal
pixel-art NFL coaching / GM / owner game played in a phone browser (portrait,
iPhone 17 Pro Max). Another AI (Claude) writes the game code and will consume
your files directly, so exact file names, sizes and JSON field names matter
more than anything else. Do not ask me questions; make sensible decisions,
write them down in README.md, and keep going.

DELIVERABLE: one zip file named mikeball-assets-v1.zip whose single top-level
folder is mikeball-assets/. Build every file with your Python tool, run the
validator described at the end, then zip and give me the download link. If you
cannot finish everything in one reply, work in the priority order below
(Tier 1 first), deliver a zip containing everything finished so far plus
TODO.md listing what's left, and when I say "continue", add the rest and give
me a new, complete, cumulative zip with the same name and structure.

TEAM IDS (use exactly these everywhere, uppercase):
BUF MIA NE NYJ BAL CIN CLE PIT HOU IND JAX TEN DEN KC LV LAC
DAL NYG PHI WAS CHI DET GB MIN ATL CAR NO TB ARI LAR SF SEA

ACCURACY: Use real, current NFL information as of the latest date you can
verify (browse the web if you can). Record that date as "as_of" in
manifest.json. Never pad with invented people without flagging them: any
uncertain record gets "confidence": "low". Hex colors are 6-digit uppercase
("#E31837").

FOLDER LAYOUT

mikeball-assets/
  manifest.json            every file: path, type, size in bytes, sha256, pixel dimensions for images
  README.md                what's inside, decisions you made, known gaps
  TODO.md                  only if something is unfinished
  validation_report.txt    output of the validator
  tools/validate.py        the validator itself
  data/                    Tier 1
  art/teams/               Tier 2
  art/league/              Tier 2
  art/stadiums/            Tier 3
  art/ui/                  Tier 3
  art/portraits/           Tier 4
  audio/sfx/               Tier 5
  audio/music/             Tier 5
  previews/                contact sheets for each art folder at 4x zoom (for humans)

=====================================================================
TIER 1 — DATA (JSON, UTF-8, 2-space indent)
=====================================================================

1) data/teams.json — array of 32:
  { "id": "KC", "city": "Kansas City", "name": "Chiefs", "abbr": "KC",
    "conference": "AFC", "division": "West",
    "colors": { "primary": "#...", "secondary": "#...", "tertiary": "#..." or null, "accent": "#..." or null },
    "location": { "city": "...", "state": "MO", "lat": 39.05, "lon": -94.48, "timezone": "America/Chicago" },
    "stadium_id": "arrowhead",
    "rivals": ["DEN", "LV", "LAC"] }

2) data/uniforms.json — object keyed by team id. Each team has "home",
"away", and "alternates" (array, may be empty; each alternate has a "name").
Every uniform object:
  { "helmet": { "shell": "#...", "facemask": "#...",
                "stripe": { "pattern": "none|single|double|triple|wide_center|split", "colors": ["#..."] },
                "decal": "logo|number|none", "decal_mirrored_on_left": true },
    "jersey": { "base": "#...", "numbers": "#...", "number_outline": "#..." or null,
                "number_style": "block|rounded|serif|angular",
                "sleeve_stripe": { "pattern": "none|single|double|triple|band", "colors": ["#..."] },
                "shoulder_numbers": true, "collar": "#...", "side_panel": "#..." or null },
    "pants": { "base": "#...", "stripe": { "pattern": "none|single|double|triple|wide", "colors": ["#..."] } },
    "socks": { "base": "#...", "stripe": { "pattern": "none|single|double|triple", "colors": ["#..."] } },
    "cleats": "#..." }

3) data/stadiums.json — array; shared stadiums appear once with both teams:
  { "id": "arrowhead", "name": "...", "team_ids": ["KC"], "city": "...", "state": "...",
    "lat": 0, "lon": 0, "timezone": "...", "elevation_ft": 0,
    "roof": "open|dome|retractable", "surface": "grass|turf", "capacity": 0, "opened": 1972,
    "climate": { "sep": { "avg_temp_f": 0, "precip_pct": 0, "snow_pct": 0 }, "oct": {...}, "nov": {...}, "dec": {...}, "jan": {...} },
    "look": "2-3 sentences of art direction: shape, roof, signature features, surroundings" }

4) data/rosters.json — { "as_of": "YYYY-MM-DD", "players": [ ... ] } with every
team's 53-man active roster (add practice squad players with "practice_squad": true
if you can). Each player:
  { "id": "kc_firstname_lastname" (lowercase ascii, add _2 if duplicate),
    "team": "KC", "first": "...", "last": "...", "number": 15,
    "pos": "QB|RB|WR|TE|OL|DL|LB|CB|S|K|P",
    "pos_detail": "QB|RB|FB|WR|TE|LT|LG|C|RG|RT|DE|DT|NT|EDGE|OLB|ILB|MLB|CB|NCB|FS|SS|K|P|LS",
    "depth": 1 (1 = starter at pos_detail, 2 = backup, ...),
    "birthdate": "YYYY-MM-DD", "age": 0, "height_in": 0, "weight_lb": 0,
    "college": "...", "experience": 0,
    "draft": { "year": 0, "round": 0, "pick": 0 } or null for undrafted,
    "contract": { "type": "rookie|veteran|extension|franchise_tag|min", "apy": 0, "cap_hit": 0,
                  "years_left": 0, "guaranteed_remaining": 0, "free_agent_year": 0 },
    "ratings": { ... see RATINGS below ... },
    "traits": { "loyalty": 1-10, "greed": 1-10, "competitor": 1-10, "ego": 1-10, "durability": 1-10 },
    "appearance": { ... see APPEARANCE below ... },
    "injury": null or { "status": "out|doubtful|questionable|ir", "body_part": "..." },
    "confidence": "high|low" }

  RATINGS — integers 0-100, all 22 keys on every player (use low values for
  skills a position doesn't use). Calibration: 40 = barely an NFL player,
  60 = backup, 72 = average starter, 82 = Pro Bowl, 90 = All-Pro,
  96+ = all-time great. Spread players realistically; don't cluster everyone
  at 75-85. Keys:
    spd speed · acc acceleration · agi agility/change of direction · str strength
    awr awareness/football IQ
    thp throw power · tha throw accuracy · dec QB decisions/reads
    car ball security · elu elusiveness · cth catching · rte route running
    rbk run blocking · pbk pass blocking
    prs pass rush · rsd run defense/block shedding · tkl tackling
    mcv man coverage · zcv zone coverage · bsk ball skills (INTs, PBUs)
    kpw kick power · kac kick accuracy

  APPEARANCE — drives the pixel sprites (players are 22x28 px, so only bold
  traits matter):
    { "skin_tone": 0-5 (0 #F3CFAE, 1 #E3B18C, 2 #C98D66, 3 #A8714B, 4 #7F5236, 5 #5C3A26 — pick the closest),
      "hair_style": "short|bald|buzz|braids|dreads_short|dreads_long|afro|long_flowing|ponytail|mullet|curly",
      "hair_color": "#...", "facial_hair": "none|stubble|mustache|goatee|full_beard|long_beard",
      "visor": "none|clear|smoke|black|gold_mirror|blue_mirror|team_color",
      "eye_black": "none|stripes|stickers", "arm_sleeves": "none|left|right|both", "arm_sleeve_color": "#..." or null,
      "leg_tights": false, "gloves": "#...", "towel": false, "cleats": "#..." or null }

5) data/coaches.json — array of 32:
  { "team": "KC", "head_coach": "...", "oc": "...", "dc": "...",
    "offense_scheme": "west_coast|spread|air_raid|wide_zone|power_run|vertical|rpo",
    "defense_front": "4-3|3-4|multiple", "coverage_shell": "single_high|two_high|multiple",
    "run_pass_lean": -1.0 to 1.0 (-1 run heavy, 1 pass heavy),
    "fourth_down_aggression": 0-100, "blitz_rate": 0-100, "tempo": 0-100 }

6) data/standings_2025.json — final 2025 regular season:
  [ { "team": "KC", "w": 0, "l": 0, "t": 0, "division_rank": 1, "conference_seed": 1 or null, "playoff_result": "..." } ]

7) data/schedule_2026.json — the full 2026 regular season (18 weeks, 272 games):
  { "official": true or false, "games": [ { "id": "2026_w01_KC_DEN", "week": 1, "date": "YYYY-MM-DD",
    "kickoff_et": "20:20", "home": "KC", "away": "DEN",
    "slot": "thursday_night|sunday_early|sunday_late|sunday_night|monday_night|saturday|thanksgiving|christmas|international|black_friday|opener",
    "site": "stadium id, or a neutral venue name and city for international games" } ],
    "byes": { "5": ["KC", ...], ... } }
  If you can't verify the real schedule, generate one that follows NFL
  scheduling rules exactly (6 division games, 4 vs a same-conference
  division, 4 vs an other-conference division, 2 same-place intra-conference,
  1 same-place 17th game, one bye per team, byes between weeks 5 and 14) from
  the 2025 standings, and set "official": false.

8) data/league.json:
  { "season": 2026, "salary_cap": 0, "cap_floor_pct": 89, "roster_max": 53, "practice_squad_max": 16,
    "min_salary_by_experience": { "0": 0, "1": 0, ... "7+": 0 },
    "rookie_scale_by_pick": [ { "pick": 1, "total_4yr": 0 }, ... all 32 first-round picks, then round averages for rounds 2-7 ],
    "franchise_tag_by_position": { "QB": 0, ... },
    "trade_deadline_week": 9, "playoff_teams_per_conference": 7,
    "rules_notes": [ "short bullets on current kickoff rules, touchback spots, overtime, two-point, challenges" ],
    "combine_benchmarks": { "QB": { "forty": { "p10": 0, "p25": 0, "p50": 0, "p75": 0, "p90": 0 },
        "ten_split": {...}, "bench_225": {...}, "vertical_in": {...}, "broad_in": {...},
        "three_cone": {...}, "shuttle": {...}, "height_in": {...}, "weight_lb": {...}, "arm_in": {...} },
      "RB": {...}, "WR": {...}, "TE": {...}, "OL": {...}, "DL": {...}, "LB": {...}, "CB": {...}, "S": {...}, "K": {...}, "P": {...} } }
  (p10 = the elite end for timed drills and the low end for reps/jumps; state the
  convention in README.md.)

=====================================================================
PIXEL ART RULES (apply to every image)
=====================================================================
- True pixel art at native size: 1 image pixel = 1 art pixel. Never upscale
  the files themselves (previews/ is the only exception).
- PNG, RGBA, hard alpha only (every pixel alpha 0 or 255), no anti-aliasing,
  no blur, no gradients except deliberate dithering.
- At most 16 colors per sprite or logo, 32 per stadium panorama.
- Light comes from the top-left. Small art gets a 1 px dark outline that is a
  darkened version of the color it touches (selective outline), not pure black.
- Style: chunky, bright, 16-bit sports pixel art with clean silhouettes,
  matching team colors from uniforms.json.
- Recommended method: draw at the target size directly in Python (PIL,
  pixel by pixel from character grids). If you use your image generator,
  bring the result into Python, downscale to the exact grid with
  nearest-neighbor/box sampling, quantize to the color limit, make alpha hard,
  and hand-clean stray pixels. Either way, the saved file must meet these rules.

=====================================================================
TIER 2 — TEAM AND LEAGUE ART
=====================================================================
For every team id, in art/teams/{ID}/:
  logo_16.png          16x16   primary logo, transparent background
  logo_32.png          32x32
  logo_64.png          64x64
  wordmark.png         height exactly 16, width ≤ 160, transparent, team wordmark
  helmet_decal_6x5.png 6x5     the helmet-side decal as seen on a tiny sprite, facing RIGHT
  helmet_decal_10x8.png 10x8   same, larger
  midfield_96.png      96x96   the logo as painted on the turf at midfield, transparent
  endzone_320x60.png   320x60  full end zone art: team-color background, lettering, logos
  endzone_text_320x60.png 320x60 the same lettering and logos only, transparent background
  uniform_card.png     48x64   a small sprite of a player in the home uniform (front view), for previews

art/league/:
  league_logo_32.png, league_logo_64.png, afc_32.png, nfc_32.png,
  championship_trophy_32x48.png, conference_trophy_afc_32x40.png, conference_trophy_nfc_32x40.png

=====================================================================
TIER 3 — STADIUMS AND UI
=====================================================================
art/stadiums/{stadium_id}_day.png and {stadium_id}_night.png — 640x240,
opaque, a wide aerial/three-quarter panorama of the stadium exterior and
surroundings (used for pre-game flyover and panning shots; the game pans
across the width). Follow the "look" text in stadiums.json. Night versions
have lit stadium lights, a dark sky and a glowing bowl. Dome/retractable
stadiums show their roof.

art/ui/ (all transparent unless noted):
  coin_heads_16.png, coin_tails_16.png, coin_flip_strip_96x16.png (6 frames of 16x16, left to right)
  weather_{sun|clouds|rain|snow|wind|dome|night}_16.png
  icon_{injury|contract|money|trade|draft|scout|star|whistle|flag|timeout|challenge|football}_16.png
  primetime_{thursday_night|sunday_night|monday_night|international|thanksgiving|christmas|playoffs|championship}_240x60.png
    — broadcast-style title cards, transparent background, readable at 2x
  title_logo_MikeBall_200x60.png — the word "MikeBall" as a bold pixel logo
  confetti_strip_64x8.png (8 frames of 8x8) and camera_flash_strip_32x8.png (4 frames of 8x8)

=====================================================================
TIER 4 — PORTRAITS
=====================================================================
art/portraits/{player_id}.png — 32x32, transparent, head-and-shoulders pixel
portrait (helmet off, team-color jersey collar) for each team's starting QB and
its two highest-rated other players: 96 portraits. Use the player's
appearance fields so portraits match the sprites.

=====================================================================
TIER 5 — AUDIO (synthesize in Python; WAV, mono, 16-bit, 22050 Hz, peak -1 dBFS)
=====================================================================
audio/sfx/: whistle.wav, snap.wav (ball hike thump), pads_hit.wav, big_hit.wav,
catch.wav, kick.wav, punt.wav, crowd_loop.wav (10 s, seamless loop),
crowd_roar.wav (3 s swell), crowd_groan.wav, touchdown.wav (short 8-bit fanfare),
field_goal_good.wav, flag.wav, clock_tick.wav, horn.wav (end of quarter),
menu_tap.wav, menu_back.wav, badge_reveal.wav, draft_pick.wav.
audio/music/: title_theme.wav (60 s chiptune loop), primetime_intro.wav (8 s),
halftime.wav (30 s loop). Keep every file under 2 MB.

=====================================================================
VALIDATION (do this before zipping)
=====================================================================
Write tools/validate.py and run it. It must check, and print PASS/FAIL per line:
- all 32 team ids present in teams.json, uniforms.json, coaches.json, standings_2025.json
- every team's roster: 46-60 active players, unique jersey numbers within the team,
  at least 2 QB, 1 K, 1 P, all 22 rating keys present and 0-100, all enum fields valid
- schedule: 272 games (or explain), each team 17 games and exactly 1 bye, no team twice in a week
- every image listed in this spec exists with the exact pixel size, RGBA, hard alpha
  (opaque files excepted), and within its color limit
- every audio file is a valid WAV with the stated format
- manifest.json lists every file with a correct sha256
Save the output as validation_report.txt. Fix every FAIL you can, rerun, then zip.

Finally, show me the previews/ contact sheets in the chat, give a short summary
of anything marked low confidence, and give me the single download link to
mikeball-assets-v1.zip.

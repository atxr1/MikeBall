"""Build the tiny helmet logos the player sprites paint on the side of the
helmet: assets/teams/{ID}/helmet_5x4.png.

Source is the pack's 10x8 helmet decal, shrunk with an alpha-weighted box
filter and every pixel snapped to the team's own colors, so a 5x4 blob still
reads as that team's logo in clean team colors instead of muddy averages.
Teams with plain helmets (Cleveland) get no file.

Usage: python3 tools/make-helmet-decals.py
"""

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
TEAMS = ROOT / "assets" / "teams"
PLAIN = {"CLE"}  # no helmet logo in real life
W, H = 5, 4


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def palette(team):
    c = team["colors"]
    k = team["uniforms"]["home"]
    cols = [c["primary"], c["secondary"], c.get("tertiary") or "#FFFFFF", "#FFFFFF", "#101820", k["helmet"], k.get("stripe") or k["helmet"]]
    out = []
    for h in cols:
        if h and hex_rgb(h) not in out:
            out.append(hex_rgb(h))
    return out


def nearest(rgb, pal):
    return min(pal, key=lambda p: (p[0] - rgb[0]) ** 2 * 0.3 + (p[1] - rgb[1]) ** 2 * 0.59 + (p[2] - rgb[2]) ** 2 * 0.11)


def shrink(img, pal):
    img = img.convert("RGBA")
    big = img.resize((W * 8, H * 8), Image.LANCZOS)
    px = big.load()
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for y in range(H):
        for x in range(W):
            r = g = b = a = 0
            for yy in range(8):
                for xx in range(8):
                    pr, pg, pb, pa = px[x * 8 + xx, y * 8 + yy]
                    r += pr * pa
                    g += pg * pa
                    b += pb * pa
                    a += pa
            if a / 64 > 100:
                out.putpixel((x, y), nearest((r // a, g // a, b // a), pal) + (255,))
    return out


def main():
    league = json.loads((ROOT / "assets" / "data" / "league.json").read_text())
    teams = league["teams"] if isinstance(league["teams"], list) else list(league["teams"].values())
    made = 0
    for t in teams:
        dst = TEAMS / t["id"] / "helmet_5x4.png"
        if t["id"] in PLAIN:
            dst.unlink(missing_ok=True)
            continue
        src = TEAMS / t["id"] / "helmet_decal_10x8.png"
        if not src.exists():
            continue
        shrink(Image.open(src), palette(t)).save(dst)
        made += 1
    print(f"wrote {made} helmet decals")


if __name__ == "__main__":
    main()

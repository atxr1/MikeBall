"""Copy the chosen files from the ChatGPT asset packs into the repo's assets/.

The owner delivered three packs (v1, v2, v3). They share most files; where
they differ, the best version of each family was picked by eye (see
assets/README.md). This tool encodes those picks so the import can be redone.

Usage (dev only, the game never runs this):
  python3 -I tools/import_assets.py --v1 DIR --v2 DIR --v3 DIR [--out assets]
where each DIR is an extracted pack's `mikeball-assets/` folder.

Everything read from the packs is treated as untrusted data: images are
re-encoded through Pillow after checking size and alpha, JSON is parsed and
re-serialized, WAVs are checked for the expected format.
"""

import argparse
import hashlib
import json
import shutil
import wave
from pathlib import Path

from PIL import Image

TEAM_IDS = "BUF MIA NE NYJ BAL CIN CLE PIT HOU IND JAX TEN DEN KC LV LAC DAL NYG PHI WAS CHI DET GB MIN ATL CAR NO TB ARI LAR SF SEA".split()

# family -> pack version to take it from
PICKS = {
    "logos": "v1",          # identical in all three packs
    "midfield": "v1",       # identical
    "helmet_decals": "v1",  # identical
    "wordmark": "v2",       # v2 == v3, real wordmarks (v1 were generic block letters)
    "endzone": "v2",        # v2 == v3, authentic end zone designs
    "uniform_card": "v2",   # v2 == v3, more detailed
    "league": "v1",         # identical
    "ui": "v1",             # identical
    "stadiums": "v1",       # v1 clean pixel art; v2 posterized photos, v3 wireframe
    "portraits": "v1",      # v1 clean pixel art; v2 posterized photos, v3 glitchy
    "audio": "v1",          # identical
    "data": "v3",           # v3 rosters have refined appearance; uniforms fixed since v2
}

DATA_FILES = [
    "teams.json", "uniforms.json", "rosters.json", "stadiums.json", "coaches.json",
    "schedule_2026.json", "league.json", "standings_2025.json", "portrait_index.json", "sources.json",
]

# v3 bonus families kept for later milestones (category -> output folder)
EXTRA = {
    "helmet": "extra/helmets",
    "uniform_card": "extra/uniforms",
    "ui_icon": "extra/icons",
    "referee_signal": "extra/referees",
    "historical_logo": "extra/logos_historical",
    "endzone": "extra/endzones",
    "endzone_text": "extra/endzones",
    # TV-network graphics are imported by tools/import_broadcast.py
}

manifest = []


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def put_image(src, dst, size=None, opaque=False, transform=None, source=""):
    im = Image.open(src)
    im.load()
    if size and im.size != tuple(size):
        raise SystemExit(f"bad size {src}: {im.size} != {size}")
    im = im.convert("RGBA")
    px = im.getchannel("A")
    lo, hi = px.getextrema()
    if not opaque:
        # hard alpha only
        bad = sum(1 for a in px.getdata() if a not in (0, 255))
        if bad:
            raise SystemExit(f"soft alpha in {src}")
    if transform:
        im = transform(im)
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, optimize=True)
    manifest.append({"path": str(dst), "source": source, "w": im.width, "h": im.height, "sha256": sha(dst)})


def put_json(src, dst, source=""):
    data = json.loads(Path(src).read_text(encoding="utf-8"))
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    manifest.append({"path": str(dst), "source": source, "sha256": sha(dst)})
    return data


def put_wav(src, dst, source=""):
    with wave.open(str(src), "rb") as w:
        if (w.getnchannels(), w.getsampwidth(), w.getframerate()) != (1, 2, 22050):
            raise SystemExit(f"unexpected wav format {src}")
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)
    manifest.append({"path": str(dst), "source": source, "sha256": sha(dst)})


def hsl(rgb):
    r, g, b = (v / 255 for v in rgb)
    mx, mn = max(r, g, b), min(r, g, b)
    l = (mx + mn) / 2
    if mx == mn:
        return 0, 0, l
    d = mx - mn
    s = d / (2 - mx - mn) if l > 0.5 else d / (mx + mn)
    if mx == r:
        h = ((g - b) / d) % 6
    elif mx == g:
        h = (b - r) / d + 2
    else:
        h = (r - g) / d + 4
    return h * 60, s, l


def grass_like(rgb):
    h, s, l = hsl(rgb)
    return 70 <= h <= 135 and 0.15 <= s <= 0.6 and 0.2 <= l <= 0.55


def key_grass(team_colors):
    """End zones painted on grass: make the grass transparent so the game's
    own turf shows through. Team-color backgrounds are left alone."""
    keep = {c.upper() for c in team_colors if c}

    def fn(im):
        counts = im.getcolors(1 << 16) or []
        counts.sort(reverse=True)
        bg = counts[0][1][:3]
        bg_hex = "#%02X%02X%02X" % bg
        if not grass_like(bg) or bg_hex in keep:
            return im
        out = im.copy()
        px = out.load()
        for y in range(out.height):
            for x in range(out.width):
                r, g, b, a = px[x, y]
                hx = "#%02X%02X%02X" % (r, g, b)
                if a and hx not in keep and grass_like((r, g, b)):
                    px[x, y] = (0, 0, 0, 0)
        return out

    return fn


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--v1", required=True)
    ap.add_argument("--v2", required=True)
    ap.add_argument("--v3", required=True)
    ap.add_argument("--out", default="assets")
    a = ap.parse_args()
    packs = {"v1": Path(a.v1), "v2": Path(a.v2), "v3": Path(a.v3)}
    out = Path(a.out)
    for sub in ("teams", "league", "stadiums", "portraits", "ui", "audio", "data/raw", "extra"):
        if (out / sub).exists():
            shutil.rmtree(out / sub)

    P = lambda fam: packs[PICKS[fam]]

    # data
    for f in DATA_FILES:
        put_json(P("data") / "data" / f, out / "data/raw" / f, f"{PICKS['data']}/data/{f}")
    teams = json.loads((out / "data/raw/teams.json").read_text())
    put_json(packs["v3"] / "surprise/data/uniform_variants.json", out / "data/raw/uniform_variants.json", "v3/surprise")

    # team art
    for t in teams:
        tid = t["id"]
        src = lambda fam, name: P(fam) / "art/teams" / tid / name
        dst = out / "teams" / tid
        for n, s in (("logo_16.png", 16), ("logo_32.png", 32), ("logo_64.png", 64)):
            put_image(src("logos", n), dst / n, (s, s), source=f"{PICKS['logos']}")
        put_image(src("midfield", "midfield_96.png"), dst / "midfield_96.png", (96, 96), source=PICKS["midfield"])
        put_image(src("helmet_decals", "helmet_decal_6x5.png"), dst / "helmet_decal_6x5.png", (6, 5), source=PICKS["helmet_decals"])
        put_image(src("helmet_decals", "helmet_decal_10x8.png"), dst / "helmet_decal_10x8.png", (10, 8), source=PICKS["helmet_decals"])
        put_image(src("wordmark", "wordmark.png"), dst / "wordmark.png", source=PICKS["wordmark"])
        colors = list(t["colors"].values())
        put_image(src("endzone", "endzone_320x60.png"), dst / "endzone.png", (320, 60), opaque=True,
                  transform=key_grass(colors), source=PICKS["endzone"])
        put_image(src("endzone", "endzone_text_320x60.png"), dst / "endzone_text.png", (320, 60), source=PICKS["endzone"])
        put_image(src("uniform_card", "uniform_card.png"), dst / "uniform_card.png", (48, 64), source=PICKS["uniform_card"])

    # logos that are too dark to read on the game's dark UI get an outline
    meta = {}
    for t in teams:
        im = Image.open(out / "teams" / t["id"] / "logo_32.png").convert("RGBA")
        px = [p for p in im.getdata() if p[3] == 255]
        bright = sum(1 for r, g, b, a in px if (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55) / max(1, len(px))
        meta[t["id"]] = {"dark": bright < 0.1}
    (out / "teams/logo_meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")

    # league art, ui
    for f in sorted((P("league") / "art/league").glob("*.png")):
        put_image(f, out / "league" / f.name, source=PICKS["league"])
    for f in sorted((P("ui") / "art/ui").glob("*.png")):
        put_image(f, out / "ui" / f.name, source=PICKS["ui"])

    # stadiums, portraits
    for f in sorted((P("stadiums") / "art/stadiums").glob("*.png")):
        put_image(f, out / "stadiums" / f.name, (640, 240), opaque=True, source=PICKS["stadiums"])
    for f in sorted((P("portraits") / "art/portraits").glob("*.png")):
        put_image(f, out / "portraits" / f.name, (32, 32), source=PICKS["portraits"])

    # audio
    for kind in ("sfx", "music"):
        for f in sorted((P("audio") / "audio" / kind).glob("*.wav")):
            put_wav(f, out / "audio" / kind / f.name, source=PICKS["audio"])

    # v3 bonus families worth keeping
    cat = json.loads((packs["v3"] / "surprise/catalog.json").read_text())
    kept = []
    for item in cat["assets"]:
        folder = EXTRA.get(item["category"])
        if not folder or item.get("type") != "image/png":
            continue
        rel = Path(item["path"])
        team = item.get("team")
        name = rel.name
        dst = out / folder / (team or "") / name
        if dst.exists():
            dst = out / folder / (team or "") / f"{rel.parent.name}_{name}"
        put_image(packs["v3"] / rel, dst, (item["width"], item["height"]), opaque=item.get("alpha") == "opaque", source="v3/surprise")
        entry = {k: v for k, v in item.items() if k in ("id", "category", "width", "height", "team", "network", "variant_id", "label", "name", "frames", "anchor")}
        entry["path"] = str(dst.relative_to(out))
        kept.append(entry)
    (out / "extra").mkdir(parents=True, exist_ok=True)
    (out / "extra/catalog.json").write_text(json.dumps(kept, indent=1), encoding="utf-8")

    (out / "manifest.json").write_text(json.dumps({"picks": PICKS, "files": manifest}, indent=1), encoding="utf-8")
    print(f"imported {len(manifest)} files, {len(kept)} extras")


if __name__ == "__main__":
    main()

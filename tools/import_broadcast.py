"""Import the TV-network graphics from the v3 pack's surprise folder into
assets/broadcast/{network}/: logos, scorebugs and their team-color masks,
title cards (kickoff, touchdown, ...) and lower thirds, plus the scorebug
layouts (assets/broadcast/layouts.json).

Usage (dev only, the game never runs this):
  python3 -I tools/import_broadcast.py --v3 DIR [--out assets]
where DIR is the extracted v3 pack's `mikeball-assets/` folder.

The pack is untrusted data: every image is opened with Pillow, checked
against its catalog size and for hard alpha, and re-encoded; the layouts are
parsed, checked (every rectangle inside its scorebug) and re-serialized.
"""

import argparse
import json
import shutil
from pathlib import Path

from PIL import Image

CATEGORIES = {"broadcast_title", "network_logo", "scorebug", "scorebug_mask", "lower_third"}
NETWORKS = {"cbs", "fox", "nbc", "espn", "abc", "prime", "nfl_network", "netflix", "peacock", "paramount"}
MAX_SIDE = 400


def put_image(src, dst, size):
    im = Image.open(src)
    im.load()
    if im.size != tuple(size) or max(im.size) > MAX_SIDE:
        raise SystemExit(f"bad size {src}: {im.size} != {size}")
    im = im.convert("RGBA")
    if sum(im.getchannel("A").histogram()[1:255]):
        raise SystemExit(f"soft alpha in {src}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, optimize=True)


def check_rect(r, w, h, where):
    if not (isinstance(r, list) and len(r) == 4 and all(isinstance(v, int) for v in r)):
        raise SystemExit(f"bad rect {where}: {r}")
    x, y, rw, rh = r
    if x < 0 or y < 0 or rw <= 0 or rh <= 0 or x + rw > w or y + rh > h:
        raise SystemExit(f"rect outside scorebug {where}: {r}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--v3", required=True)
    ap.add_argument("--out", default="assets")
    a = ap.parse_args()
    root = Path(a.v3)
    out = Path(a.out) / "broadcast"
    if out.exists():
        shutil.rmtree(out)

    cat = json.loads((root / "surprise/catalog.json").read_text(encoding="utf-8"))
    n = 0
    for item in cat["assets"]:
        if item.get("category") not in CATEGORIES or item.get("type") != "image/png":
            continue
        rel = Path(item["path"])
        parts = rel.parts
        if len(parts) != 5 or parts[:3] != ("surprise", "art", "broadcast") or parts[3] not in NETWORKS:
            raise SystemExit(f"unexpected path {rel}")
        put_image(root / rel, out / parts[3] / parts[4], (item["width"], item["height"]))
        n += 1

    raw = json.loads((root / "surprise/data/broadcast_layouts.json").read_text(encoding="utf-8"))
    layouts = {}
    for net, fams in raw.items():
        if net not in NETWORKS:
            continue
        layouts[net] = {}
        for fam, lay in fams.items():
            w, h = lay["width"], lay["height"]
            fields = {k: v for k, v in lay["fields"].items()}
            for k, r in fields.items():
                check_rect(r, w, h, f"{net}.{fam}.{k}")
            tos = lay.get("timeout_rects", {})
            for side in ("away", "home"):
                for r in tos.get(side, []):
                    check_rect(r, w, h, f"{net}.{fam}.timeouts")
            layouts[net][fam] = {
                "file": Path(lay["path"]).name,
                "mask": Path(lay["team_color_mask"]).name,
                "width": w,
                "height": h,
                "fields": fields,
                "textColor": lay.get("text_color", "#F0F0DA"),
                "textColors": lay.get("text_colors", {}),
                "timeouts": tos,
                "possession": lay.get("possession_markers", {}),
            }
    (out / "layouts.json").write_text(json.dumps(layouts, indent=1), encoding="utf-8")
    print(f"imported {n} broadcast images for {len(layouts)} scorebug networks")


if __name__ == "__main__":
    main()

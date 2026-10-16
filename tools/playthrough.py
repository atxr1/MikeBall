"""Plays a whole game headlessly at high speed through the real UI to catch
runtime errors (dialogs, PATs, kickoffs, halftime, overtime, final).

Usage: python3 tools/playthrough.py [--games 2] [--speed 8]
"""

import argparse
import sys
import time

from screenshot import serve, VIEWPORT, OUT
from playwright.sync_api import sync_playwright


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=2)
    ap.add_argument("--speed", type=float, default=8)
    ap.add_argument("--q", type=int, default=5)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    httpd, port = serve()
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for gi in range(args.games):
            ctx = browser.new_context(viewport=VIEWPORT, device_scale_factor=1, is_mobile=True, has_touch=True)
            ctx.route("**/fonts.g*/**", lambda r: r.abort())
            page = ctx.new_page()
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" and "Failed to load resource" not in m.text else None)
            teams = [("KC", "BUF"), ("PHI", "DAL"), ("SF", "SEA"), ("DET", "GB")][gi % 4]
            page.goto(f"http://127.0.0.1:{port}/index.html?autostart=1&team={teams[0]}&opp={teams[1]}&q={args.q}&seed={100 + gi}&speed={args.speed}")
            page.wait_for_selector(".coach")
            snaps = 0
            dialogs = 0
            t_end = time.time() + 420
            while time.time() < t_end:
                if page.locator(".final-screen").count():
                    break
                if page.locator(".dialog").count():
                    btns = page.locator(".dialog-buttons button")
                    btns.nth(dialogs % btns.count()).click()
                    dialogs += 1
                    continue
                go = page.locator(".actions .go")
                if go.count() and go.is_enabled():
                    tabs = page.locator(".tab")
                    if tabs.count():
                        tabs.nth(snaps % tabs.count()).click()
                    cards = page.locator(".card:not([disabled])")
                    if cards.count():
                        cards.nth((snaps * 7) % cards.count()).click()
                    if page.locator(".actions .go").is_enabled():
                        page.locator(".actions .go").click()
                        snaps += 1
                    continue
                if page.locator(".banner:not([hidden])").count():
                    page.locator(".stage").click()
                time.sleep(0.05)
            final = page.locator(".final-screen").count() > 0
            score = page.locator(".final-score").inner_text() if final else "(no final)"
            print(f"game {gi + 1}: {teams[0]} v {teams[1]} snaps={snaps} dialogs={dialogs} final={final} {score.replace(chr(10), ' ')}")
            if not final:
                page.screenshot(path=str(OUT / f"stuck-{gi}.png"))
                errors.append(f"game {gi + 1} did not finish")
            ctx.close()
        browser.close()
    httpd.shutdown()
    for e in errors[:30]:
        print("  ", e)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()

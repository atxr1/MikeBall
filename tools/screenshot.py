"""Boot MikeBall at iPhone 17 Pro Max size in headless Chromium, walk through
the menus, call some plays, and save screenshots + a console log to tools/out/.

Usage: python3 tools/screenshot.py [--plays N] [--scale 2]
"""

import argparse
import functools
import http.server
import os
import socketserver
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tools" / "out"
VIEWPORT = {"width": 440, "height": 956}  # iPhone 17 Pro Max in CSS px


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plays", type=int, default=6)
    ap.add_argument("--scale", type=float, default=2)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob("*.png"):
        f.unlink()
    httpd, port = serve()
    logs = []
    shot_n = [0]

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(
            viewport=VIEWPORT,
            device_scale_factor=args.scale,
            is_mobile=True,
            has_touch=True,
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        )
        # Fonts come from Google; don't hang if the network blocks them.
        ctx.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        ctx.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        page = ctx.new_page()
        page.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
        page.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))

        def shot(name):
            shot_n[0] += 1
            path = OUT / f"{shot_n[0]:02d}-{name}.png"
            page.screenshot(path=str(path))
            print("saved", path.name)

        page.goto(f"http://127.0.0.1:{port}/index.html")
        page.wait_for_selector(".team-tile")
        time.sleep(0.4)
        shot("title")

        page.locator(".team-tile").nth(1).click()
        page.wait_for_selector(".setup-screen")
        shot("setup")

        page.get_by_text("Depth chart").click()
        page.wait_for_selector(".roster-list .p-row")
        page.locator(".p-row").first.click()
        time.sleep(0.3)
        shot("roster")
        page.get_by_label("Close roster").click()

        page.get_by_text("Kick off").click()
        page.wait_for_selector(".coach")
        time.sleep(1.0)
        shot("intro")

        def wait_ready(timeout=40):
            """Wait until the user can call a play or must answer a dialog."""
            end = time.time() + timeout
            while time.time() < end:
                if page.locator(".dialog").count():
                    return "dialog"
                if page.locator(".final-screen").count():
                    return "final"
                go = page.locator(".actions .go")
                if go.count() and go.is_enabled():
                    return "call"
                if page.locator(".banner:not([hidden])").count():
                    page.locator(".stage").click()
                time.sleep(0.25)
            return "timeout"

        plays = 0
        first_call = True
        while plays < args.plays:
            state = wait_ready()
            if state == "dialog":
                shot("dialog")
                page.locator(".dialog .go").first.click()
                continue
            if state != "call":
                logs.append(f"[tool] stopped waiting: {state}")
                break
            if first_call:
                shot("call")
                first_call = False
            # switch to the second tab and pick the second card for variety
            tabs = page.locator(".tab")
            if tabs.count() > 1 and plays % 2 == 1:
                tabs.nth(1).click()
            cards = page.locator(".card:not([disabled])")
            if cards.count() > 1:
                cards.nth(min(plays % 3, cards.count() - 1)).click()
            time.sleep(0.3)
            shot(f"art-{plays}")
            page.locator(".actions .go").click()
            time.sleep(1.4)
            shot(f"play-{plays}")
            plays += 1

        if page.locator(".final-screen").count() == 0:
            state = wait_ready()
            if state == "dialog":
                page.locator(".dialog .go").first.click()
                wait_ready()
            page.locator(".actions .act", has_text="Menu").click()
            page.wait_for_selector(".dialog")
            shot("menu")
            page.get_by_text("Sim to the end").click()
        page.wait_for_selector(".final-screen", timeout=60000)
        time.sleep(0.3)
        shot("final")
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        time.sleep(0.2)
        shot("final-bottom")
        browser.close()

    httpd.shutdown()
    (OUT / "console.log").write_text("\n".join(logs) + "\n")
    errors = [l for l in logs if l.startswith("[error]") or l.startswith("[pageerror]")]
    print(f"console: {len(logs)} lines, {len(errors)} errors")
    for e in errors[:20]:
        print("  ", e)


if __name__ == "__main__":
    main()

"""Screenshot any repo page (e.g. tools/sprites.html) at its natural size.

Usage: python3 tools/page_shot.py tools/sprites.html out.png [query]
"""

import sys

from playwright.sync_api import sync_playwright
from screenshot import serve


def main():
    page_path, out = sys.argv[1], sys.argv[2]
    query = sys.argv[3] if len(sys.argv) > 3 else ""
    httpd, port = serve()
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1400, "height": 900})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(f"http://127.0.0.1:{port}/{page_path}?{query}")
        pg.wait_for_function("document.title === 'ready'", timeout=15000)
        pg.locator("canvas").first.screenshot(path=out)
        b.close()
        for e in errs:
            print("pageerror:", e)
    httpd.shutdown()


if __name__ == "__main__":
    main()

"""Season-mode playtest: drives index.html through the season flow at iPhone
size and saves screenshots + a JSON log to tools/out/playtest/.

Usage: python3 tools/playtest_season.py SCENARIO [--team KC] [--w 440 --h 956]
  scenarios: main, out, small, files
"""

import argparse
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from screenshot import serve, ROOT  # noqa: E402
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout  # noqa: E402

OUT = ROOT / "tools" / "out" / "playtest"

# iPhone 17 Pro Max as a home-screen app: status bar / Dynamic Island and
# the home indicator. Drawn on top of every screenshot (pointer-events off).
OVERLAY_JS = r"""
(insets) => {
  if (document.getElementById('pt-overlay')) return;
  const st = document.createElement('style');
  st.id = 'pt-style';
  st.textContent = `html:root { --safe-t: ${insets.t}px !important; --safe-b: ${insets.b}px !important; }`;
  document.head.append(st);
  const o = document.createElement('div');
  o.id = 'pt-overlay';
  o.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  if (insets.t) {
    const isl = document.createElement('div');
    isl.style.cssText = 'position:absolute;left:50%;top:11px;width:126px;height:37px;margin-left:-63px;border-radius:19px;background:rgba(0,0,0,.85);outline:1px solid rgba(255,0,255,.7)';
    const line = document.createElement('div');
    line.style.cssText = `position:absolute;left:0;right:0;top:${insets.t}px;border-top:1px dashed rgba(255,0,255,.55)`;
    o.append(isl, line);
  }
  if (insets.b) {
    const bar = document.createElement('div');
    bar.style.cssText = 'position:absolute;left:50%;bottom:8px;width:140px;height:5px;margin-left:-70px;border-radius:3px;background:rgba(255,255,255,.8);outline:1px solid rgba(255,0,255,.7)';
    const line = document.createElement('div');
    line.style.cssText = `position:absolute;left:0;right:0;bottom:${insets.b}px;border-top:1px dashed rgba(255,0,255,.55)`;
    o.append(bar, line);
  }
  document.body.append(o);
}
"""

AUDIT_JS = r"""
() => {
  const vw = innerWidth;
  const out = { scrollW: document.documentElement.scrollWidth, vw, hscroll: false, small: [], off: [], clipped: [], suspect: [] };
  out.hscroll = document.documentElement.scrollWidth > vw + 1 || document.body.scrollWidth > vw + 1;
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
  const label = (el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const desc = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().replace(/\s+/g, '.') : ''}`;
  const inScroller = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const cs = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) return p; } return null; };
  for (const el of document.querySelectorAll('button, a[href], [role=tab], [role=radio], input:not([type=file]), select')) {
    if (!vis(el) || el.closest('#pt-overlay') || el.closest('canvas')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) out.small.push(`${desc(el)} "${label(el)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  for (const el of document.querySelectorAll('#app *, .sheet *')) {
    if (!vis(el) || el.closest('#pt-overlay')) continue;
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 1 || r.left < -1) && !inScroller(el)) out.off.push(`${desc(el)} "${label(el)}" ${Math.round(r.left)}..${Math.round(r.right)}`);
    const cs = getComputedStyle(el);
    if ((cs.textOverflow === 'ellipsis' || /(hidden|clip)/.test(cs.overflowX)) && el.scrollWidth > el.clientWidth + 1 && el.textContent.trim() && el.tagName !== 'CANVAS' && !/(chips|segment|scroll|hub-tabs)/.test(el.className)) out.clipped.push(`${desc(el)} "${label(el)}" ${el.scrollWidth}>${el.clientWidth}`);
  }
  // numbers that look like player ratings: "OVR", "rating", or 2-digit numbers 40-99 by a player name in roster rows
  const txt = document.body.innerText;
  for (const m of txt.matchAll(/\b(OVR|Overall|Rating|Rtg|Grade)\b[^\n]{0,30}/gi)) out.suspect.push(m[0]);
  return out;
}
"""


class Run:
    def __init__(self, p, port, name, w, h, insets=True, scale=2):
        self.name = name
        self.port = port
        self.browser = p.chromium.launch()
        self.ctx = self.browser.new_context(
            viewport={"width": w, "height": h}, device_scale_factor=scale, is_mobile=True, has_touch=True,
            accept_downloads=True,
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        )
        self.ctx.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        self.ctx.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        self.page = self.ctx.new_page()
        self.logs = []
        self.notes = []
        self.audits = {}
        self.n = 0
        self.insets = {"t": 62, "b": 34} if insets else {"t": 0, "b": 0}
        self.page.on("console", lambda m: self.logs.append(f"[{m.type}] {m.text}"))
        self.page.on("pageerror", lambda e: self.logs.append(f"[pageerror] {e}"))

    def goto(self, qs=""):
        self.page.goto(f"http://127.0.0.1:{self.port}/index.html{qs}")
        self.page.wait_for_selector(".team-tile, .hub-screen")
        time.sleep(0.4)
        self.overlay()

    def overlay(self):
        self.page.evaluate(OVERLAY_JS, self.insets)

    def shot(self, label, full=False, audit=True):
        self.n += 1
        self.overlay()
        name = f"{self.name}-{self.n:02d}-{label}.png"
        self.page.screenshot(path=str(OUT / name), full_page=full)
        if audit:
            a = self.page.evaluate(AUDIT_JS)
            self.audits[name] = a
            flags = []
            if a["hscroll"]:
                flags.append(f"HSCROLL {a['scrollW']}>{a['vw']}")
            if a["off"]:
                flags.append(f"off={len(a['off'])}")
            if a["clipped"]:
                flags.append(f"clipped={len(a['clipped'])}")
            if a["small"]:
                flags.append(f"small={len(a['small'])}")
            if a["suspect"]:
                flags.append(f"RATING? {a['suspect'][:3]}")
            print("saved", name, " ".join(flags))
        else:
            print("saved", name)
        return name

    def note(self, s):
        print("NOTE", s)
        self.notes.append(s)

    def season(self):
        return self.page.evaluate("() => window.MikeBall && window.MikeBall.season ? JSON.parse(JSON.stringify(window.MikeBall.season)) : null")

    def state(self):
        """Compact summary of the season for the log."""
        return self.page.evaluate(r"""() => {
          const a = window.MikeBall, s = a.season; if (!s) return null;
          const mine = s.games.filter(g => g.home === s.userId || g.away === s.userId).map(g => ({ w: g.week, id: g.id, h: g.home, a: g.away, hs: g.hs, as: g.as, ot: g.ot }));
          return { year: s.year, phase: s.phase, week: s.week, lastWeek: s.lastWeek, rec: a.seasonRecord(s), champion: s.champion, mine, saved: (localStorage.getItem('mikeball:season') || '').length };
        }""")

    def click_text(self, sel, text, timeout=5000):
        self.page.locator(sel, has_text=text).first.click(timeout=timeout)

    def tab(self, text):
        self.page.locator(".hub-tabs .chip", has_text=text).first.click()
        time.sleep(0.15)

    def wait_ready(self, timeout=40):
        p = self.page
        end = time.time() + timeout
        while time.time() < end:
            if p.locator(".dialog").count():
                return "dialog"
            if p.locator(".final-screen").count():
                return "final"
            go = p.locator(".actions .go")
            try:
                if go.count() and go.is_enabled(timeout=500):
                    return "call"
            except PWTimeout:
                pass
            if p.locator(".banner:not([hidden])").count():
                try:
                    p.locator(".stage").click(timeout=1000)
                except PWTimeout:
                    pass
            time.sleep(0.2)
        return "timeout"

    def snaps(self, n, label="snap"):
        p = self.page
        done = 0
        while done < n:
            st = self.wait_ready()
            if st == "dialog":
                self.shot(f"{label}-dialog")
                # leave in-game menu dialogs alone
                p.locator(".dialog .go").first.click()
                continue
            if st != "call":
                self.note(f"snaps: stopped waiting ({st})")
                return st
            cards = p.locator(".card:not([disabled])")
            if cards.count() > 1:
                cards.nth(done % cards.count()).click()
            time.sleep(0.2)
            p.locator(".actions .go").click()
            time.sleep(2.5)
            self.shot(f"{label}-{done}")
            done += 1
        return "ok"

    def in_game_menu(self):
        p = self.page
        st = self.wait_ready()
        if st == "dialog":
            p.locator(".dialog .go").first.click()
            self.wait_ready()
        p.locator(".actions .act", has_text="Menu").click()
        p.wait_for_selector(".dialog")
        time.sleep(0.2)

    def finish(self):
        (OUT / f"{self.name}-console.log").write_text("\n".join(self.logs) + "\n")
        (OUT / f"{self.name}-audit.json").write_text(json.dumps({"notes": self.notes, "audits": self.audits}, indent=1))
        errs = [l for l in self.logs if l.startswith("[error]") or l.startswith("[pageerror]") or l.startswith("[warning]")]
        print(f"console: {len(self.logs)} lines, {len(errs)} errors/warnings")
        for e in errs[:30]:
            print("  ", e)
        self.browser.close()


def hub_tour(r, prefix, deep=True):
    p = r.page
    r.tab("Schedule")
    r.shot(f"{prefix}-schedule", full=True)
    r.tab("Scores")
    r.shot(f"{prefix}-scores", full=True)
    if deep:
        nxt = p.get_by_label("Next week")
        if nxt.is_enabled():
            nxt.click(); time.sleep(0.1)
            r.shot(f"{prefix}-scores-next", full=False)
        prv = p.get_by_label("Previous week")
        if prv.is_enabled():
            prv.click(); time.sleep(0.1)
            prv.click() if prv.is_enabled() else None
            time.sleep(0.1)
            r.shot(f"{prefix}-scores-prev", full=False)
    r.tab("Standings")
    p.locator(".standings .segment button", has_text="Divisions").click()
    p.locator(".standings .segment button", has_text="AFC").click()
    r.shot(f"{prefix}-stand-afc-div", full=True)
    if deep:
        p.locator(".standings .segment button", has_text="NFC").click()
        r.shot(f"{prefix}-stand-nfc-div", full=False)
    p.locator(".standings .segment button", has_text="Playoff race").click()
    p.locator(".standings .segment button", has_text="AFC").click()
    r.shot(f"{prefix}-stand-race", full=True)
    p.locator(".standings .segment button", has_text="Divisions").click()
    r.tab("Leaders")
    r.shot(f"{prefix}-leaders", full=True)
    if deep:
        for cat in ["Rushing yards", "Sacks", "Field goals"]:
            p.locator(".leaders-tab .chip", has_text=cat).first.click()
            time.sleep(0.1)
            r.shot(f"{prefix}-leaders-{cat.split()[0].lower()}")
    if p.locator(".hub-tabs .chip", has_text="Playoffs").count():
        r.tab("Playoffs")
        r.shot(f"{prefix}-playoffs", full=True)
    if p.locator(".hub-tabs .chip", has_text="Awards").count():
        r.tab("Awards")
        r.shot(f"{prefix}-awards", full=True)
    r.tab("Schedule")


def hub_menu(r):
    r.page.locator(".hub-menu").click()
    r.page.wait_for_selector(".dialog")
    time.sleep(0.1)


def sim_until(r, cond, limit=25, label="sim"):
    """Press the hub's Sim / Sim week button until cond(state) is true."""
    p = r.page
    for _ in range(limit):
        st = r.state()
        if cond(st):
            return st
        btn = p.locator(".hub-next button", has_text=re.compile(r"^Sim( week| round)?$"))
        if not btn.count():
            r.note(f"{label}: no Sim button at {st['phase']} week {st['week']}")
            return st
        btn.first.click()
        p.wait_for_selector(".hub-screen")
        time.sleep(0.1)
    return r.state()


def play_and_sim(r, label, snaps=2):
    p = r.page
    p.locator(".hub-next .go", has_text="Play").click()
    p.wait_for_selector(".coach")
    time.sleep(1.5)
    r.shot(f"{label}-intro")
    r.snaps(snaps, label=f"{label}-snap")
    r.in_game_menu()
    r.shot(f"{label}-menu")
    p.locator(".dialog button", has_text="Sim to the end").click()
    p.wait_for_selector(".final-screen", timeout=90000)
    time.sleep(0.4)
    r.shot(f"{label}-final")
    r.shot(f"{label}-final-full", full=True)
    verdict = p.locator(".final-verdict").inner_text()
    score = p.locator(".final-score").inner_text().replace("\n", " ")
    p.locator(".final-screen .go", has_text="Continue").click()
    p.wait_for_selector(".hub-screen")
    time.sleep(0.2)
    return verdict, score


# ------------------------------------------------------------------ scenarios

def scenario_main(r, team):
    p = r.page
    r.goto()
    r.shot("title-fresh", full=True)
    p.get_by_role("tab", name="Single game").click()
    time.sleep(0.1)
    r.shot("title-single")
    p.locator(".team-tile", has_text="Chiefs").click()
    p.wait_for_selector(".setup-screen")
    r.shot("single-setup", full=True)
    p.get_by_label("Back to teams").click()
    p.wait_for_selector(".team-tile")
    r.shot("title-back-from-single")  # which mode does it come back in?
    p.get_by_role("tab", name="Season").click()
    tname = {"KC": "Chiefs", "BUF": "Bills", "PHI": "Eagles", "DEN": "Broncos", "BAL": "Ravens", "DET": "Lions"}.get(team, team)
    if p.locator(".team-tile", has_text=tname).count() == 0:
        p.locator(".segment button", has_text="NFC").first.click()
    p.locator(".team-tile", has_text=tname).first.click()
    p.wait_for_selector(".season-setup")
    time.sleep(0.2)
    r.shot("season-setup")
    r.shot("season-setup-full", full=True)
    p.get_by_role("radio", name="5 min", exact=True).click()
    p.locator(".season-setup .setup-actions .act", has_text="Depth chart").click()
    p.wait_for_selector(".roster-list .p-row")
    time.sleep(0.2)
    r.shot("setup-depth")
    p.locator(".p-row").first.click()
    time.sleep(0.2)
    r.shot("setup-depth-player")
    p.get_by_label("Close roster").click()
    time.sleep(0.2)
    p.locator(".season-setup .go", has_text="Start season").click()
    p.wait_for_selector(".hub-screen")
    time.sleep(0.2)
    r.shot("hub-week1")
    r.note(f"after start: {json.dumps(r.state())[:400]}")
    hub_tour(r, "w1")
    hub_menu(r)
    r.shot("hub-menu")
    p.locator(".dialog button", has_text="Depth chart").click()
    p.wait_for_selector(".roster-list .p-row")
    r.shot("hub-depth")
    p.get_by_label("Close roster").click()
    hub_menu(r)
    p.locator(".dialog button", has_text="Main menu").click()
    p.wait_for_selector(".team-tile")
    time.sleep(0.2)
    r.shot("title-continue")
    # reload: does the season survive?
    r.goto()
    r.shot("title-after-reload")
    has_card = p.locator(".season-card").count()
    r.note(f"after reload: season-card={has_card}, titleMode tab selected={p.locator('.mode-bar [aria-selected=true]').inner_text() if p.locator('.mode-bar [aria-selected=true]').count() else None}")
    # new season confirmation with another team
    p.locator(".team-tile").nth(0).click()
    p.wait_for_selector(".season-setup")
    p.locator(".season-setup .go", has_text="Start season").click()
    time.sleep(0.2)
    r.shot("new-season-confirm")
    p.locator(".dialog button", has_text="Cancel").click()
    p.get_by_label("Back to teams").click()
    p.wait_for_selector(".season-card")
    p.locator(".season-card .go").click()
    p.wait_for_selector(".hub-screen")

    # play week 1, quit -> should not count
    st0 = r.state()
    p.locator(".hub-next .go", has_text="Play").click()
    p.wait_for_selector(".coach")
    time.sleep(1.5)
    r.shot("g1-intro")
    r.snaps(3, label="g1-snap")
    r.in_game_menu()
    r.shot("g1-menu")
    p.locator(".dialog button", has_text="Quit").click()
    p.wait_for_selector(".hub-screen")
    time.sleep(0.2)
    r.shot("hub-after-quit")
    st1 = r.state()
    r.note(f"quit: week {st0['week']}->{st1['week']} rec {st0['rec']}->{st1['rec']} mine0={[g for g in st1['mine'] if g['w']==st0['week']]}")

    # play it for real, sim to the end
    verdict, score = play_and_sim(r, "g1b", snaps=2)
    st2 = r.state()
    r.note(f"g1 final: {verdict} | {score} | now week {st2['week']} rec {st2['rec']} last={st2['lastWeek']}")
    r.shot("hub-after-g1")
    r.tab("Schedule")
    r.shot("hub-after-g1-schedule", full=True)
    r.tab("Scores")
    r.shot("hub-after-g1-scores", full=True)
    r.tab("Standings")
    r.shot("hub-after-g1-standings", full=True)
    r.tab("Leaders")
    r.shot("hub-after-g1-leaders")
    r.tab("Schedule")

    # sim to the bye
    bye = None
    for g in range(1, 19):
        if not any(x["w"] == g for x in st2["mine"]):
            bye = g
            break
    r.note(f"bye week: {bye}")
    st = sim_until(r, lambda s: s["week"] == bye or s["phase"] != "regular", label="to-bye")
    r.shot("hub-bye-week")
    r.tab("Scores")
    r.shot("hub-bye-scores")
    r.tab("Schedule")
    p.locator(".hub-next button", has_text="Sim week").click()
    p.wait_for_selector(".hub-screen")
    time.sleep(0.2)
    r.shot("hub-after-bye")
    r.note(f"after bye: {json.dumps(r.state())[:300]}")
    # one simmed user game
    p.locator(".hub-next button", has_text="Sim").last.click()
    p.wait_for_selector(".hub-screen")
    time.sleep(0.2)
    r.shot("hub-after-simmed-game")
    r.tab("Schedule")
    r.shot("hub-after-simmed-schedule", full=True)
    # sim to the playoffs
    hub_menu(r)
    p.locator(".dialog button", has_text="Sim to the playoffs").click()
    time.sleep(0.15)
    r.shot("sim-ahead-confirm")
    t0 = time.time()
    p.locator(".dialog .go", has_text="Sim it").click()
    p.wait_for_selector(".hub-screen .bracket", timeout=120000)
    r.note(f"sim to playoffs took {time.time()-t0:.1f}s")
    time.sleep(0.3)
    r.shot("hub-playoffs-start")
    st = r.state()
    r.note(f"at playoffs: {json.dumps(st)[:600]}")
    hub_tour(r, "po", deep=False)
    hub_menu(r)
    r.shot("hub-menu-playoffs")
    p.locator(".dialog button", has_text="Close").click()
    # playoff loop
    for i in range(6):
        st = r.state()
        if st["phase"] == "done":
            break
        if p.locator(".hub-next .go", has_text="Play").count():
            r.shot(f"po{i}-next")
            verdict, score = play_and_sim(r, f"po{i}", snaps=1)
            r.note(f"playoff game {i}: {verdict} | {score}")
            r.shot(f"po{i}-hub-after")
        else:
            r.shot(f"po{i}-nogame")
            txt = p.locator(".hub-next").inner_text().replace("\n", " | ")
            r.note(f"playoff card {i}: {txt}")
            if p.locator(".hub-next button", has_text="Sim to the end").count() and i >= 1:
                p.locator(".hub-next button", has_text="Sim to the end").click()
            else:
                p.locator(".hub-next button", has_text="Sim").first.click()
            p.wait_for_selector(".hub-screen")
            time.sleep(0.2)
    r.shot("season-done")
    r.tab("Playoffs")
    r.shot("season-done-bracket", full=True)
    r.tab("Schedule")
    r.shot("season-done-schedule", full=True)
    st = r.state()
    r.note(f"done: {json.dumps(st)[:900]}")
    p.locator(".hub-menu").click()
    r.shot("hub-menu-done")
    p.locator(".dialog button", has_text="Main menu").click()
    p.wait_for_selector(".team-tile")
    r.shot("title-season-over")
    p.locator(".season-card .go").click()
    p.wait_for_selector(".hub-screen")
    p.locator(".hub-next .go", has_text="Start").click()
    p.wait_for_selector(".season-setup")
    time.sleep(0.2)
    r.shot("setup-2027", full=True)
    p.locator(".season-setup .go", has_text="Start season").click()
    time.sleep(0.3)
    if p.locator(".dialog").count():
        r.shot("setup-2027-confirm")
        p.locator(".dialog .go").click()
    p.wait_for_selector(".hub-screen")
    time.sleep(0.2)
    r.shot("hub-2027")
    info = p.evaluate(r"""() => { const s = window.MikeBall.season; const w1 = s.games.filter(g => g.week === 1).sort((a,b)=>a.date.localeCompare(b.date)); return { year: s.year, lastChampion: s.lastChampion, opener: w1[0], champGame: w1.find(g => g.home === s.lastChampion || g.away === s.lastChampion), n: s.games.length, weeks: [...new Set(s.games.map(g=>g.week))].length }; }""")
    r.note(f"2027: {json.dumps(info)}")
    hub_tour(r, "y27", deep=False)


def scenario_out(r, team):
    """A weak team: miss the playoffs (or get knocked out) and watch."""
    p = r.page
    r.goto()
    tname = team
    p.locator(".team-tile", has_text=tname).first.click()
    p.wait_for_selector(".season-setup")
    p.locator(".season-setup .go", has_text="Start season").click()
    p.wait_for_selector(".hub-screen")
    hub_menu(r)
    p.locator(".dialog button", has_text="Sim to the playoffs").click()
    p.locator(".dialog .go", has_text="Sim it").click()
    p.wait_for_selector(".hub-screen .bracket", timeout=120000)
    time.sleep(0.2)
    r.shot("playoffs-out")
    r.note(f"at playoffs: {json.dumps(r.state())[:500]}")
    r.tab("Standings")
    p.locator(".standings .segment button", has_text="Playoff race").click()
    r.shot("race-final", full=True)
    r.tab("Schedule")
    r.shot("schedule-final", full=True)
    for i in range(5):
        st = r.state()
        if st["phase"] == "done":
            break
        r.shot(f"round{i}")
        r.note(f"card {i}: {p.locator('.hub-next').inner_text().replace(chr(10), ' | ')}")
        if p.locator(".hub-next .go", has_text="Play").count():
            verdict, score = play_and_sim(r, f"po{i}", snaps=0)
            r.note(f"playoff {i}: {verdict} {score}")
            continue
        if i == 0:
            p.locator(".hub-next button", has_text="Sim round").click()
        else:
            p.locator(".hub-next button", has_text=re.compile("Sim to the end|Sim round")).last.click()
        p.wait_for_selector(".hub-screen")
        time.sleep(0.2)
    r.shot("champion")
    r.tab("Playoffs")
    r.shot("champion-bracket", full=True)
    r.tab("Scores")
    r.shot("champion-scores", full=True)
    r.note(f"done: {json.dumps(r.state())[:300]}")


def scenario_files(r, team):
    p = r.page
    r.goto()
    p.locator(".team-tile").nth(2).click()
    p.wait_for_selector(".season-setup")
    p.locator(".season-setup .go", has_text="Start season").click()
    p.wait_for_selector(".hub-screen")
    p.locator(".hub-next button", has_text="Sim").last.click()
    p.wait_for_selector(".hub-screen")
    before = r.state()
    hub_menu(r)
    with p.expect_download() as dl:
        p.locator(".dialog button", has_text="Save to file").click()
    d = dl.value
    path = OUT / "files-export.json"
    d.save_as(str(path))
    r.note(f"download name={d.suggested_filename} size={path.stat().st_size}")
    r.shot("after-save")
    # wipe and load it back
    p.evaluate("() => localStorage.removeItem('mikeball:season')")
    r.goto()
    r.shot("title-wiped")
    # can we get to Load from file without a season? (only from the hub menu)
    r.note(f"title has Load option: {p.get_by_text('Load from file').count()}")
    # start a different season, then load the file over it
    p.locator(".team-tile").nth(5).click()
    p.wait_for_selector(".season-setup")
    p.locator(".season-setup .go", has_text="Start season").click()
    p.wait_for_selector(".hub-screen")
    hub_menu(r)
    with p.expect_file_chooser() as fc:
        p.locator(".dialog button", has_text="Load from file").click()
    fc.value.set_files(str(path))
    time.sleep(0.6)
    r.shot("after-load")
    after = r.state()
    r.note(f"load ok: before={before['rec']} wk{before['week']} after={after['rec']} wk{after['week']} same={before['mine']==after['mine']}")
    # a bad file
    bad = OUT / "files-bad.json"
    bad.write_text('{"hello": 1}')
    hub_menu(r)
    with p.expect_file_chooser() as fc:
        p.locator(".dialog button", has_text="Load from file").click()
    fc.value.set_files(str(bad))
    time.sleep(0.3)
    r.shot("bad-load-toast")


def scenario_small(r, team):
    """375x667: every season screen once."""
    p = r.page
    r.goto()
    r.shot("title")
    r.shot("title-full", full=True)
    p.locator(".team-tile").nth(3).click()
    p.wait_for_selector(".season-setup")
    r.shot("setup")
    r.shot("setup-full", full=True)
    p.locator(".season-setup .go", has_text="Start season").click()
    p.wait_for_selector(".hub-screen")
    r.shot("hub")
    p.locator(".hub-next button", has_text="Sim").last.click()
    p.wait_for_selector(".hub-screen")
    hub_tour(r, "w2", deep=False)
    hub_menu(r)
    r.shot("menu")
    p.locator(".dialog button", has_text="Close").click()
    p.locator(".hub-menu").click()
    p.locator(".dialog button", has_text="Main menu").click()
    p.wait_for_selector(".season-card")
    r.shot("title-continue")
    p.locator(".season-card .go").click()
    p.wait_for_selector(".hub-screen")
    p.locator(".hub-next .go", has_text="Play").click()
    p.wait_for_selector(".coach")
    time.sleep(1.5)
    r.shot("coach-intro")
    r.snaps(1, label="snap")
    r.in_game_menu()
    r.shot("coach-menu")
    p.locator(".dialog button", has_text="Sim to the end").click()
    p.wait_for_selector(".final-screen", timeout=90000)
    time.sleep(0.3)
    r.shot("final")
    r.shot("final-full", full=True)
    p.locator(".final-screen .go", has_text="Continue").click()
    p.wait_for_selector(".hub-screen")
    hub_menu(r)
    p.locator(".dialog button", has_text="Sim to the playoffs").click()
    r.shot("confirm")
    p.locator(".dialog .go", has_text="Sim it").click()
    p.wait_for_selector(".hub-screen .bracket", timeout=120000)
    time.sleep(0.2)
    r.shot("playoffs")
    hub_tour(r, "po", deep=False)
    for i in range(6):
        if r.state()["phase"] == "done":
            break
        btn = p.locator(".hub-next button", has_text=re.compile("^Sim"))
        btn.last.click()
        p.wait_for_selector(".hub-screen")
        time.sleep(0.1)
    r.shot("done")
    p.locator(".hub-next .go", has_text="Start").click()
    p.wait_for_selector(".season-setup")
    r.shot("setup-next", full=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("scenario")
    ap.add_argument("--team", default="KC")
    ap.add_argument("--w", type=int, default=440)
    ap.add_argument("--h", type=int, default=956)
    ap.add_argument("--no-insets", action="store_true")
    ap.add_argument("--name", default=None)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    httpd, port = serve()
    fn = {"main": scenario_main, "out": scenario_out, "small": scenario_small, "files": scenario_files}[args.scenario]
    with sync_playwright() as p:
        r = Run(p, port, args.name or args.scenario, args.w, args.h, insets=not args.no_insets)
        try:
            fn(r, args.team)
        except Exception as e:  # keep what we have
            r.note(f"EXCEPTION {type(e).__name__}: {e}")
            try:
                r.shot("exception")
            except Exception:
                pass
        finally:
            r.finish()
    httpd.shutdown()


if __name__ == "__main__":
    main()

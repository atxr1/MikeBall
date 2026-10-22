// Who blocks whom at the snap, mixed into PlaySim: man protection for
// passes (and draws and straight-ahead runs), and the run-blocking rules of
// each scheme (zone, gap with pullers and a lead back). Assignments are
// starting points: blockers adjust once the play's going
// (src/sim/offense.js passPro, runBlock). No DOM; no randomness here.

export const blockingMethods = {
  assignInitialBlocks() {
    const ballX = this.ballX;
    // the men on the line in the box (a pressed corner out wide isn't one)
    const rushers = this.defense.filter((d) => d.y < 1.6 && Math.abs(d.x - ballX) < 8.5);
    const blockers = this.offense.filter((p) => p.pos === 'OL');
    const taken = new Map();
    // drawn blocking assignments first
    for (const b of this.offense) {
      const t = b.job.target && this.defBySlot[b.job.target];
      if (t) { b.target = t; taken.set(t, b); }
    }
    if (this.offPlay.cat === 'pass' || this.offPlay.cat === 'special' || this.isDraw || (this.offPlay.cat === 'run' && !this.offPlay.dir)) {
      // Man protection: the linemen take the men on the line in order
      // across, none crossing another's face. With more rushers than
      // linemen the widest is left for a back; with fewer, the spare
      // lineman helps where he's needed (looseRusher, src/sim/offense.js).
      const usedB = new Set([...taken.values()]);
      const B = blockers.filter((b) => !usedB.has(b)).sort((a, b) => a.x - b.x);
      const R = rushers.filter((r) => !taken.has(r)).sort((a, b) => a.x - b.x);
      for (const [b, r] of protectionPairs(B, R, ballX)) {
        b.target = r;
        taken.set(r, b);
      }
    } else if (this.offPlay.cat === 'run') {
      this.assignRunBlocks(taken);
    }
  },

  // Run blocking by the scheme's rules, playside first.
  //  Zone: each blocker takes the man on him or in his playside gap; one
  //  with nobody there combos and climbs to a linebacker.
  //  Gap (a lineman pulls): playside of the puller they block down, inside;
  //  backside of him they block their playside gap (the man next to him
  //  covers the gap he left). The end man on the playside is kicked out by
  //  the lead back, or by the puller when there's no lead back; the puller
  //  otherwise leads up on the playside linebacker.
  // A drawn assignment always stands; anyone left without a man finds one
  // once the play's going (pickRunTarget, src/sim/offense.js).
  assignRunBlocks(taken) {
    const ballX = this.ballX;
    const dir = this.offPlay.dir || 0;
    const sgn = dir || 1;
    // with two pullers (a GT counter), the first one there kicks out and the
    // second leads up
    const pullers = this.offense.filter((p) => p.job.t === 'pull' && !p.target).sort((a, b) => (b.x - a.x) * (dir || 1));
    const puller = pullers[pullers.length > 1 ? 1 : 0];
    const lead = this.offense.find((p) => p.job.t === 'lead' && !p.target && p.pos !== 'QB') || (pullers.length > 1 ? pullers[0] : null);
    const free = (d) => !taken.has(d);
    const front = this.defense.filter((d) => d.y < 2 && Math.abs(d.x - ballX) < 10 && (d.pos === 'DL' || d.pos === 'LB'));
    const backers = this.defense.filter((d) => d.y >= 2 && d.y < 7 && Math.abs(d.x - ballX) < 9);
    const take = (b, d) => { b.target = d; taken.set(d, b); };
    // the playside end man
    let emol = null;
    for (const d of front) if (dir && (!emol || (d.x - emol.x) * dir > 0)) emol = d;
    if (puller && emol && free(emol) && (emol.x - ballX) * dir > 1) {
      take(lead || puller, emol);
    }
    const line = this.offense
      .filter((p) => (p.pos === 'OL' || (p.pos === 'TE' && Math.abs(p.y) < 1.5)) && p.job.t !== 'pull' && !p.target)
      .sort((a, b) => (b.x - a.x) * sgn); // playside first
    const climb = [];
    for (const b of line) {
      const back = puller && (b.x - puller.x) * sgn < 0; // backside of the puller
      let lo;
      let hi;
      if (!puller) { lo = -0.9; hi = 2.2; } // zone: on him or playside
      else if (back) { lo = -1.8; hi = 2.4; } // back block / hinge
      else { lo = -2.4; hi = 0.6; } // down block
      const aim = b.x + sgn * (puller && !back ? -0.9 : 0.9);
      let best = null;
      let bd = 1e9;
      for (const d of front) {
        if (!free(d)) continue;
        const rel = (d.x - b.x) * sgn;
        if (rel < lo || rel > hi) continue;
        const c = Math.abs(d.x - aim);
        if (c < bd) { bd = c; best = d; }
      }
      if (best) take(b, best);
      else climb.push(b);
    }
    // the puller leads up through the hole on the playside linebacker
    if (puller && !puller.target) {
      let best = null;
      let bd = 1e9;
      const hole = ballX + dir * 3;
      for (const d of backers) {
        if (!free(d) || (d.x - ballX) * sgn < -1.5) continue;
        const c = Math.abs(d.x - hole);
        if (c < bd) { bd = c; best = d; }
      }
      if (best) take(puller, best);
    }
    // nobody on them: up to the nearest linebacker on their side of the play
    for (const b of climb) {
      let best = null;
      let bd = 1e9;
      for (const d of backers) {
        if (!free(d)) continue;
        const c = Math.abs(d.x - (b.x + sgn * 1.5)) + d.y * 0.3;
        if (c < bd) { bd = c; best = d; }
      }
      if (best) take(b, best);
    }
  },
};

// The best order-preserving pairing of blockers to rushers (both sorted
// left to right): every man of the smaller group is paired, by lateral
// distance, and a rusher left over is the one farthest from the ball.
export function protectionPairs(B, R, ballX) {
  const n = B.length;
  const m = R.length;
  const INF = 1e9;
  const skipB = n > m ? 0 : INF;
  const skipR = (j) => (m > n ? -Math.abs(R[j].x - ballX) * 0.3 : INF);
  const f = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(INF));
  f[0][0] = 0;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const v = f[i][j];
      if (v >= INF) continue;
      if (i < n && j < m) f[i + 1][j + 1] = Math.min(f[i + 1][j + 1], v + Math.abs(B[i].x - R[j].x));
      if (i < n && skipB < INF) f[i + 1][j] = Math.min(f[i + 1][j], v + skipB);
      if (j < m) { const c = skipR(j); if (c < INF) f[i][j + 1] = Math.min(f[i][j + 1], v + c); }
    }
  }
  const pairs = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const v = f[i][j];
    if (i > 0 && j > 0 && Math.abs(f[i - 1][j - 1] + Math.abs(B[i - 1].x - R[j - 1].x) - v) < 1e-9) { pairs.push([B[i - 1], R[j - 1]]); i--; j--; }
    else if (i > 0 && skipB < INF && Math.abs(f[i - 1][j] + skipB - v) < 1e-9) i--;
    else if (j > 0) j--;
    else i--;
  }
  return pairs;
}

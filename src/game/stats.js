// Box score bookkeeping.

export class StatBook {
  constructor() {
    this.players = new Map(); // id -> line
    this.team = {
      home: blankTeam(),
      away: blankTeam(),
    };
  }

  line(p, side) {
    if (!p) return null;
    let l = this.players.get(p.id);
    if (!l) {
      l = { id: p.id, side, name: `${p.first[0]}. ${p.last}`, pos: p.pos, num: p.num,
        pass: { att: 0, comp: 0, yds: 0, td: 0, int: 0, sacked: 0, long: 0 },
        rush: { att: 0, yds: 0, td: 0, long: 0 },
        rec: { tgt: 0, rec: 0, yds: 0, td: 0, long: 0 },
        def: { tkl: 0, sacks: 0, int: 0, pbu: 0, ff: 0 },
        kick: { fgm: 0, fga: 0, xpm: 0, xpa: 0, long: 0 },
        punt: { n: 0, yds: 0 } };
      this.players.set(p.id, l);
    }
    return l;
  }

  leaders(side) {
    const lines = [...this.players.values()].filter((l) => l.side === side);
    const top = (fn) => lines.filter((l) => fn(l) > 0).sort((a, b) => fn(b) - fn(a))[0] || null;
    return {
      passing: top((l) => l.pass.att),
      rushing: top((l) => l.rush.yds + l.rush.att * 0.01),
      receiving: top((l) => l.rec.yds + l.rec.rec * 0.01),
      defense: top((l) => l.def.tkl + l.def.sacks * 2 + l.def.int * 3),
    };
  }
}

function blankTeam() {
  return { plays: 0, firstDowns: 0, yards: 0, passYds: 0, rushYds: 0, turnovers: 0, penalties: 0, penYds: 0, top: 0, thirdAtt: 0, thirdConv: 0, sacks: 0 };
}

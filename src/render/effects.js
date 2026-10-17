// On-field effects: turf kicking up when someone hits the ground. Fed
// from the play sim's event list; positions are in world yards.


const DUST = ['#c9b98f', '#a99a72', '#e6dcc0', '#7fae6a'];

export class Effects {
  constructor() {
    this.list = [];
    this.seen = 0;
    this.sim = null;
  }

  reset(sim) {
    this.list.length = 0;
    this.seen = 0;
    this.sim = sim;
  }

  // Turn new sim events into effects. `los` is the line of scrimmage (f).
  // Only what you'd see on a real field: turf kicking up when players hit
  // the ground. No on-screen words or comic-book bursts (broadcasts don't
  // put "JUKE!" on the screen).
  pull(sim, los) {
    if (sim !== this.sim) this.reset(sim);
    const ev = sim.events;
    for (; this.seen < ev.length; this.seen++) {
      const e = ev[this.seen];
      const who = e.who;
      const x = e.x ?? who?.x;
      const y = e.y ?? who?.y;
      if (x == null) continue;
      if (e.k === 'fall') this.dust(x, los + y);
      else if ((e.k === 'tackle' || e.k === 'sack') && e.on) this.dust(e.on.x, los + e.on.y);
    }
  }

  // Kick scenes report cosmetic events as {k, x, f} in field yards.
  pullList(owner, list) {
    if (owner !== this.sim) this.reset(owner);
    for (; this.seen < list.length; this.seen++) {
      const e = list[this.seen];
      if (e.k === 'fall') this.dust(e.x, e.f);
    }
  }

  dust(x, f) {
    const n = this.list.length;
    const puffs = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + n;
      puffs.push({ dx: Math.cos(a), dy: Math.sin(a) * 0.5, c: DUST[(i + n) % DUST.length] });
    }
    this.list.push({ type: 'dust', x, f, puffs, age: 0, life: 0.5 });
  }

  update(dt) {
    if (!this.list.length) return false;
    for (const fx of this.list) fx.age += dt;
    this.list = this.list.filter((fx) => fx.age < fx.life);
    return true;
  }

  get active() {
    return this.list.length > 0;
  }

  draw(ctx, cam) {
    for (const fx of this.list) {
      const X = Math.round(cam.sx(fx.x));
      const Y = Math.round(cam.sy(fx.f));
      const u = fx.age / fx.life;
      if (fx.type === 'dust') {
        const r = 2 + u * 7;
        for (const p of fx.puffs) {
          if (u > 0.6 && (p.dx > 0) === (u > 0.8)) continue;
          ctx.fillStyle = p.c;
          ctx.fillRect(Math.round(X + p.dx * r), Math.round(Y + p.dy * r), u < 0.5 ? 2 : 1, 1);
        }
      }
    }
  }
}

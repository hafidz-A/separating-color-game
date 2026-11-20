// The world: pills, trays, obstacles and every player's tool.
// The host steps it; guests keep a mirror that is fed by snapshots.
import { PILL_R } from './levels.js';

export const SPATULA_HALF = 78;
export const SPATULA_THICK = 7;
export const GRAB_R = 40;
export const GRAB_CAP = 6;
const SUBSTEPS = 3;

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class World {
  constructor(def) {
    this.n = def.n;
    this.W = def.W;
    this.H = def.H;
    this.friction = def.friction;
    this.obs = def.obs;
    this.trays = def.trays.map((t) => ({ ...t, bx: t.x, by: t.y, count: t.count || 0, flash: 0, nope: 0 }));
    this.pills = def.pills.map(([id, c, x, y, shape, a]) => ({
      id, c, x, y, shape, a: a || 0,
      vx: 0, vy: 0, va: 0,
      rx: x, ry: y, ra: a || 0,
      alive: true, held: -1, last: -1,
    }));
    this.byId = new Map(this.pills.map((p) => [p.id, p]));
    this.total = def.total;
    this.sorted = def.sorted || 0;
    this.time = def.time || 0;
    this.tools = new Map();
    this.events = [];
    this.updateTrays();
  }

  describe() {
    return {
      n: this.n, W: this.W, H: this.H, friction: this.friction, obs: this.obs,
      trays: this.trays.map((t) => ({ c: t.c, x: t.bx, y: t.by, w: t.w, h: t.h, count: t.count, move: t.move })),
      pills: this.pills.filter((p) => p.alive).map((p) => [p.id, p.c, Math.round(p.x), Math.round(p.y), p.shape, +p.a.toFixed(3)]),
      total: this.total, sorted: this.sorted, time: this.time,
    };
  }

  updateTrays() {
    for (const t of this.trays) {
      if (!t.move) continue;
      const off = Math.sin(this.time * t.move.spd + t.move.ph) * t.move.amp;
      if (t.move.axis === 'x') t.x = Math.max(0, Math.min(this.W - t.w, t.bx + off));
      else t.y = Math.max(0, Math.min(this.H - t.h, t.by + off));
    }
  }

  tool(pid) {
    let t = this.tools.get(pid);
    if (!t) {
      t = { pid, x: this.W / 2, y: this.H / 2, a: -0.6, tx: this.W / 2, ty: this.H / 2, ta: -0.6,
        px: this.W / 2, py: this.H / 2, pa: -0.6, kind: 'sweep', down: false, held: 0, seen: 0 };
      this.tools.set(pid, t);
    }
    return t;
  }

  setInput(pid, inp, snap) {
    const t = this.tool(pid);
    t.seen = 1;
    t.tx = Math.max(-50, Math.min(this.W + 50, +inp.x || 0));
    t.ty = Math.max(-50, Math.min(this.H + 50, +inp.y || 0));
    t.ta = wrapAngle(+inp.a || 0);
    t.kind = inp.k === 'grab' ? 'grab' : 'sweep';
    t.down = !!inp.d;
    if (snap) { t.x = t.tx; t.y = t.ty; t.a = t.ta; }
  }

  removeTool(pid) {
    for (const p of this.pills) if (p.held === pid) p.held = -1;
    this.tools.delete(pid);
  }

  // ---- host-side simulation ----
  step(dt) {
    this.time += dt;
    this.updateTrays();
    const pills = this.pills;

    for (const t of this.tools.values()) {
      t.px = t.x; t.py = t.y; t.pa = t.a;
      // Ease remote tools toward their latest input to hide network jitter.
      const k = t.local ? 1 : 0.55;
      t.x += (t.tx - t.x) * k;
      t.y += (t.ty - t.y) * k;
      t.a += wrapAngle(t.ta - t.a) * k;
      t.vx = (t.x - t.px) / dt;
      t.vy = (t.y - t.py) / dt;
      t.w = wrapAngle(t.a - t.pa) / dt;

      const grabbing = t.kind === 'grab' && t.down;
      let held = 0;
      for (const p of pills) {
        if (!p.alive || p.held !== t.pid) continue;
        if (!grabbing) { p.held = -1; p.vx *= 0.4; p.vy *= 0.4; } else held++;
      }
      if (grabbing && held < GRAB_CAP) {
        for (const p of pills) {
          if (held >= GRAB_CAP) break;
          if (!p.alive || p.held !== -1) continue;
          if ((p.x - t.x) ** 2 + (p.y - t.y) ** 2 < GRAB_R * GRAB_R) {
            p.held = t.pid; p.last = t.pid; held++;
          }
        }
      }
      t.held = held;
    }

    const h = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) {
      const frac = (s + 1) / SUBSTEPS;
      for (const p of pills) {
        if (!p.alive) continue;
        if (p.held >= 0) {
          const t = this.tools.get(p.held);
          if (t) {
            const gx = t.px + (t.x - t.px) * frac, gy = t.py + (t.y - t.py) * frac;
            const dvx = (gx - p.x) * 14, dvy = (gy - p.y) * 14;
            p.vx += (dvx - p.vx) * 0.5;
            p.vy += (dvy - p.vy) * 0.5;
          } else p.held = -1;
        }
        p.x += p.vx * h;
        p.y += p.vy * h;
        p.a += p.va * h;
      }
      this.collidePills();
      for (const t of this.tools.values()) if (t.kind === 'sweep' && t.down) this.sweep(t, frac);
      this.collideStatic();
    }

    const f = Math.pow(this.friction, dt * 60);
    for (const p of pills) {
      if (!p.alive) continue;
      p.vx *= f; p.vy *= f; p.va *= Math.pow(0.9, dt * 60);
      if (p.vx * p.vx + p.vy * p.vy < 0.5) { p.vx = 0; p.vy = 0; }
      p.rx = p.x; p.ry = p.y; p.ra = p.a;
    }
    this.checkTrays();
    for (const tr of this.trays) { tr.flash = Math.max(0, tr.flash - dt); tr.nope = Math.max(0, tr.nope - dt); }
  }

  collidePills() {
    const cell = PILL_R * 2;
    const grid = new Map();
    const pills = this.pills;
    for (let i = 0; i < pills.length; i++) {
      const p = pills[i];
      if (!p.alive) continue;
      const key = ((p.x / cell) | 0) * 8192 + ((p.y / cell) | 0);
      let arr = grid.get(key);
      if (!arr) grid.set(key, (arr = []));
      arr.push(i);
    }
    const minD = PILL_R * 2;
    for (let i = 0; i < pills.length; i++) {
      const a = pills[i];
      if (!a.alive) continue;
      const cx = (a.x / cell) | 0, cy = (a.y / cell) | 0;
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const arr = grid.get((cx + ox) * 8192 + (cy + oy));
          if (!arr) continue;
          for (const j of arr) {
            if (j <= i) continue;
            const b = pills[j];
            // Lifted pills only touch pills lifted by the same hand.
            if ((a.held >= 0 || b.held >= 0) && a.held !== b.held) continue;
            let dx = b.x - a.x, dy = b.y - a.y;
            let d2 = dx * dx + dy * dy;
            if (d2 >= minD * minD) continue;
            let d = Math.sqrt(d2);
            if (d < 1e-4) { dx = 1; dy = 0; d = 1; } else { dx /= d; dy /= d; }
            const push = (minD - d) / 2;
            a.x -= dx * push; a.y -= dy * push;
            b.x += dx * push; b.y += dy * push;
            const vn = (b.vx - a.vx) * dx + (b.vy - a.vy) * dy;
            if (vn < 0) {
              const j2 = -(1.15) * vn / 2;
              a.vx -= dx * j2; a.vy -= dy * j2;
              b.vx += dx * j2; b.vy += dy * j2;
              const vt = (b.vx - a.vx) * -dy + (b.vy - a.vy) * dx;
              a.va += vt * 0.004; b.va -= vt * 0.004;
              // Credit spreads along a pushed cluster.
              const sa = a.vx * a.vx + a.vy * a.vy, sb = b.vx * b.vx + b.vy * b.vy;
              if (sa > sb && a.last >= 0) b.last = a.last;
              else if (sb > sa && b.last >= 0) a.last = b.last;
            }
          }
        }
      }
    }
  }

  sweep(t, frac) {
    const cx = t.px + (t.x - t.px) * frac;
    const cy = t.py + (t.y - t.py) * frac;
    const ang = t.pa + wrapAngle(t.a - t.pa) * frac;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const nx = -dy, ny = dx;
    const minD = PILL_R + SPATULA_THICK;
    const reach = SPATULA_HALF + minD;
    for (const p of this.pills) {
      if (!p.alive || p.held >= 0) continue;
      const rx = p.x - cx, ry = p.y - cy;
      if (rx * rx + ry * ry > reach * reach) continue;
      const along = Math.max(-SPATULA_HALF, Math.min(SPATULA_HALF, rx * dx + ry * dy));
      const qx = cx + dx * along, qy = cy + dy * along;
      let ex = p.x - qx, ey = p.y - qy;
      let d = Math.hypot(ex, ey);
      if (d >= minD) continue;
      if (d < 1e-4) {
        // Pick the side the pill was on relative to the previous pose.
        const side = (p.x - t.px) * nx + (p.y - t.py) * ny >= 0 ? 1 : -1;
        ex = nx * side; ey = ny * side; d = 1;
      } else { ex /= d; ey /= d; }
      p.x = qx + ex * minD;
      p.y = qy + ey * minD;
      const ox = qx - cx, oy = qy - cy;
      const tvx = t.vx - t.w * oy, tvy = t.vy + t.w * ox;
      const vn = (p.vx - tvx) * ex + (p.vy - tvy) * ey;
      if (vn < 0) {
        p.vx -= vn * ex * 1.05;
        p.vy -= vn * ey * 1.05;
        p.va += ((tvx - p.vx) * -ey + (tvy - p.vy) * ex) * 0.002;
      }
      p.last = t.pid;
    }
  }

  collideStatic() {
    const R = PILL_R;
    for (const p of this.pills) {
      if (!p.alive) continue;
      if (p.held < 0) {
        for (const o of this.obs) {
          const sx = o.x2 - o.x1, sy = o.y2 - o.y1;
          const len2 = sx * sx + sy * sy;
          const u = Math.max(0, Math.min(1, ((p.x - o.x1) * sx + (p.y - o.y1) * sy) / len2));
          const qx = o.x1 + sx * u, qy = o.y1 + sy * u;
          let ex = p.x - qx, ey = p.y - qy;
          const d = Math.hypot(ex, ey);
          const minD = R + o.r;
          if (d >= minD || d < 1e-5) continue;
          ex /= d; ey /= d;
          p.x = qx + ex * minD; p.y = qy + ey * minD;
          const vn = p.vx * ex + p.vy * ey;
          if (vn < 0) { p.vx -= 1.3 * vn * ex; p.vy -= 1.3 * vn * ey; }
        }
      }
      if (p.x < R) { p.x = R; if (p.vx < 0) p.vx *= -0.3; }
      if (p.x > this.W - R) { p.x = this.W - R; if (p.vx > 0) p.vx *= -0.3; }
      if (p.y < R) { p.y = R; if (p.vy < 0) p.vy *= -0.3; }
      if (p.y > this.H - R) { p.y = this.H - R; if (p.vy > 0) p.vy *= -0.3; }
    }
  }

  checkTrays() {
    const m = 4;
    for (let ti = 0; ti < this.trays.length; ti++) {
      const tr = this.trays[ti];
      for (const p of this.pills) {
        if (!p.alive) continue;
        if (p.x < tr.x + m || p.x > tr.x + tr.w - m || p.y < tr.y + m || p.y > tr.y + tr.h - m) continue;
        if (p.c === tr.c) {
          p.alive = false;
          p.held = -1;
          tr.count++;
          tr.flash = 0.35;
          this.sorted++;
          this.events.push({ k: 'sort', id: p.id, by: p.last, c: p.c, ti, x: p.x, y: p.y });
        } else if (p.held < 0) {
          // Wrong tray: nudge the pill back toward the middle of the board.
          let ox = this.W / 2 - (tr.x + tr.w / 2), oy = this.H / 2 - (tr.y + tr.h / 2);
          const l = Math.hypot(ox, oy) || 1;
          ox /= l; oy /= l;
          p.vx = ox * 260; p.vy = oy * 260;
          p.x += ox * 3; p.y += oy * 3;
          if (tr.nope <= 0) this.events.push({ k: 'nope', ti, by: p.last });
          tr.nope = 0.4;
        }
      }
    }
  }

  get done() {
    return this.sorted >= this.total;
  }
}

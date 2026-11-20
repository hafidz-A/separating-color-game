// Mode: Golf Mini — every player putts their own ball. Each level builds a
// brand-new winding course from tiles, with more turns and hazards later on.
import { mulberry32 } from '../levels.js';

export const TILE = 200;
export const BALL_R = 8;
export const HOLE_R = 14;
const PAD = 40;
const MAX_STROKES = 10;
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

function genPath(len, rng) {
  const maxW = 7, maxH = 5;
  for (let attempt = 0; attempt < 400; attempt++) {
    const path = [[0, 0]];
    const seen = new Set(['0,0']);
    let dir = Math.floor(rng() * 4);
    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    while (path.length < len) {
      const [x, y] = path[path.length - 1];
      const opts = [];
      for (let d = 0; d < 4; d++) {
        if (d === (dir + 2) % 4) continue;
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
        if (seen.has(nx + ',' + ny)) continue;
        if (Math.max(maxX, nx) - Math.min(minX, nx) + 1 > maxW) continue;
        if (Math.max(maxY, ny) - Math.min(minY, ny) + 1 > maxH) continue;
        opts.push(d, d === dir ? d : -1); // straight ahead counts twice
      }
      const choices = opts.filter((d) => d >= 0);
      if (!choices.length) break;
      dir = choices[Math.floor(rng() * choices.length)];
      const nx = x + DIRS[dir][0], ny = y + DIRS[dir][1];
      path.push([nx, ny]);
      seen.add(nx + ',' + ny);
      minX = Math.min(minX, nx); maxX = Math.max(maxX, nx);
      minY = Math.min(minY, ny); maxY = Math.max(maxY, ny);
    }
    if (path.length === len) return path.map(([x, y]) => [x - minX, y - minY]);
  }
  return Array.from({ length: len }, (_, i) => [i, 0]);
}

export function makeDef(n, seed) {
  const rng = mulberry32(seed * 131 + n * 7919);
  const len = Math.min(3 + Math.floor(n * 0.9), 16);
  const cells = genPath(len, rng);
  const gw = Math.max(...cells.map((c) => c[0])) + 1;
  const gh = Math.max(...cells.map((c) => c[1])) + 1;
  const W = gw * TILE + PAD * 2, H = gh * TILE + PAD * 2;
  const index = new Map(cells.map(([x, y], i) => [x + ',' + y, i]));
  const cx = (c) => PAD + c[0] * TILE + TILE / 2;
  const cy = (c) => PAD + c[1] * TILE + TILE / 2;

  // Rails wherever a tile does not continue into the next one on the route.
  const walls = [];
  cells.forEach(([x, y], i) => {
    const x0 = PAD + x * TILE, y0 = PAD + y * TILE, x1 = x0 + TILE, y1 = y0 + TILE;
    const sides = [[1, 0, x1, y0, x1, y1], [0, 1, x0, y1, x1, y1], [-1, 0, x0, y0, x0, y1], [0, -1, x0, y0, x1, y0]];
    for (const [dx, dy, ax, ay, bx, by] of sides) {
      const j = index.get((x + dx) + ',' + (y + dy));
      if (j === undefined) walls.push([ax, ay, bx, by]);
      else if (Math.abs(j - i) !== 1 && i < j) walls.push([ax, ay, bx, by]);
    }
  });

  const tee = [cx(cells[0]), cy(cells[0])];
  const last = cells[cells.length - 1];
  const hole = [Math.round(cx(last) + (rng() - 0.5) * 70), Math.round(cy(last) + (rng() - 0.5) * 70)];

  // Hazards in the middle tiles; more kinds unlock as levels go up.
  const kinds = [];
  if (n >= 2) kinds.push('bumper');
  if (n >= 3) kinds.push('sand');
  if (n >= 4) kinds.push('water');
  if (n >= 5) kinds.push('bar');
  if (n >= 6) kinds.push('gate');
  const bumpers = [], sand = [], water = [], bars = [];
  const middle = cells.slice(1, -1).map((c, k) => ({ c, i: k + 1 }));
  const share = Math.min(0.35 + n * 0.07, 0.95);
  for (const { c, i } of middle) {
    if (!kinds.length || rng() > share) continue;
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const ox = (rng() - 0.5) * 70, oy = (rng() - 0.5) * 70;
    const x = Math.round(cx(c) + ox), y = Math.round(cy(c) + oy);
    if (kind === 'bumper') {
      bumpers.push([x, y, 16]);
      if (n >= 7 && rng() < 0.5) bumpers.push([Math.round(cx(c) - ox), Math.round(cy(c) - oy), 13]);
    } else if (kind === 'sand') sand.push([x, y, 44]);
    else if (kind === 'water') water.push([x, y, 36]);
    else if (kind === 'bar') bars.push([Math.round(cx(c)), Math.round(cy(c)), 130, (0.8 + n * 0.08) * (rng() < 0.5 ? -1 : 1), +(rng() * 6.28).toFixed(2)]);
    else if (kind === 'gate') {
      // A partial wall across the tile, leaving a gap on one side.
      const prev = cells[i - 1], next = cells[i + 1];
      const horizontal = prev[1] === c[1] && next[1] === c[1];
      const x0 = PAD + c[0] * TILE, y0 = PAD + c[1] * TILE;
      const gapStart = rng() < 0.5;
      const reach = TILE * 0.58;
      if (horizontal) {
        const gx = x0 + TILE / 2;
        walls.push(gapStart ? [gx, y0 + TILE - reach, gx, y0 + TILE] : [gx, y0, gx, y0 + reach]);
      } else {
        const gy = y0 + TILE / 2;
        walls.push(gapStart ? [x0 + TILE - reach, gy, x0 + TILE, gy] : [x0, gy, x0 + reach, gy]);
      }
    }
  }

  return {
    mode: 'golf', n, seed, W, H, cells, walls, tee, hole, bumpers, sand, water, bars,
    par: 2 + Math.floor(len / 4) + (n >= 5 ? 1 : 0), time: 0, balls: [],
  };
}

function segPush(b, ax, ay, bx, by, radius, e, vx = 0, vy = 0) {
  const sx = bx - ax, sy = by - ay;
  const len2 = sx * sx + sy * sy || 1;
  const u = Math.max(0, Math.min(1, ((b.x - ax) * sx + (b.y - ay) * sy) / len2));
  const qx = ax + sx * u, qy = ay + sy * u;
  let nx = b.x - qx, ny = b.y - qy;
  const d = Math.hypot(nx, ny);
  if (d >= radius || d < 1e-6) return false;
  nx /= d; ny /= d;
  b.x = qx + nx * radius; b.y = qy + ny * radius;
  const rvx = b.vx - vx, rvy = b.vy - vy;
  const vn = rvx * nx + rvy * ny;
  if (vn < 0) { b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny; }
  return true;
}

class GolfWorld {
  constructor(def) {
    this.mode = 'golf';
    this.def = def;
    Object.assign(this, { n: def.n, W: def.W, H: def.H, walls: def.walls, tee: def.tee, hole: def.hole, bumpers: def.bumpers, sand: def.sand, water: def.water, bars: def.bars, cells: def.cells, par: def.par });
    this.time = def.time || 0;
    this.balls = new Map();
    for (const [pid, x, y, strokes, holed] of def.balls || []) this.addBall(pid, x, y, strokes, holed);
    this.tools = new Map();
    this.events = [];
  }

  addBall(pid, x, y, strokes = 0, holed = 0) {
    const k = this.balls.size;
    const bx = x ?? this.tee[0] + ((k % 3) - 1) * 20;
    const by = y ?? this.tee[1] + (Math.floor(k / 3) % 3 - 1) * 20;
    const b = { pid, x: bx, y: by, vx: 0, vy: 0, rx: bx, ry: by, strokes, holed: !!holed, lastX: bx, lastY: by, aim: null, ax: 0, ay: 0 };
    this.balls.set(pid, b);
    return b;
  }

  tool(pid) {
    let t = this.tools.get(pid);
    if (!t) { t = { pid, x: this.tee[0], y: this.tee[1], a: 0, kind: 'aim', down: false, seen: 0, wasDown: false }; this.tools.set(pid, t); }
    return t;
  }

  join(pid) { this.tool(pid); if (!this.balls.has(pid)) this.addBall(pid); }
  leave(pid) { this.tools.delete(pid); this.balls.delete(pid); }

  setInput(pid, inp) {
    const t = this.tool(pid);
    t.seen = 1;
    t.x = +inp.x || 0;
    t.y = +inp.y || 0;
    t.down = !!inp.d;
    // Aim vector (sim units, up to 170 long) worked out on the player's own
    // screen from their camera, so pulling back works from any view angle.
    const gx = +inp.gx || 0, gy = +inp.gy || 0;
    const gl = Math.hypot(gx, gy);
    const k = gl > 170 ? 170 / gl : 1;
    t.gx = gx * k; t.gy = gy * k;
    if (!this.balls.has(pid)) this.addBall(pid);
  }

  // Direction (radians, sim x/y) from a point toward the next tile on the route.
  routeYaw(x, y) {
    const cx = Math.floor((x - 40) / TILE), cy = Math.floor((y - 40) / TILE);
    let i = this.cells.findIndex(([a, b]) => a === cx && b === cy);
    if (i < 0) i = 0;
    let tx, ty;
    if (i >= this.cells.length - 1) { [tx, ty] = this.hole; }
    else { const c = this.cells[i + 1]; tx = 40 + c[0] * TILE + TILE / 2; ty = 40 + c[1] * TILE + TILE / 2; }
    if (Math.hypot(tx - x, ty - y) < 1) return 0;
    return Math.atan2(ty - y, tx - x);
  }

  barEnds(bar, time = this.time) {
    const [x, y, len, spd, ph] = bar;
    const a = ph + spd * time;
    const dx = Math.cos(a) * len / 2, dy = Math.sin(a) * len / 2;
    return [x - dx, y - dy, x + dx, y + dy, a];
  }

  step(dt) {
    this.time += dt;
    // Aiming: press anywhere and pull back like a slingshot, release to putt.
    for (const t of this.tools.values()) {
      const b = this.balls.get(t.pid);
      if (!b || b.holed) { t.wasDown = t.down; continue; }
      const still = Math.hypot(b.vx, b.vy) < 5;
      if (t.down && !t.wasDown && still) b.aim = {};
      if (b.aim) {
        b.ax = t.gx || 0; b.ay = t.gy || 0;
        if (!t.down) {
          const len = Math.hypot(b.ax, b.ay);
          if (len > 10 && still) {
            const power = Math.min(len, 170) / 170;
            const speed = 70 + power * 830;
            b.vx = b.ax / len * speed; b.vy = b.ay / len * speed;
            b.lastX = b.x; b.lastY = b.y;
            b.strokes++;
            this.events.push({ k: 'shot', by: t.pid });
          }
          b.aim = null; b.ax = 0; b.ay = 0;
        }
      }
      t.wasDown = t.down;
    }

    const SUB = 4, h = dt / SUB;
    const balls = [...this.balls.values()].filter((b) => !b.holed);
    for (let s = 0; s < SUB; s++) {
      const tt = this.time - dt + h * (s + 1);
      for (const b of balls) {
        b.x += b.vx * h; b.y += b.vy * h;
        for (const [ax, ay, bx, by] of this.walls) segPush(b, ax, ay, bx, by, BALL_R + 3, 0.75);
        for (const [x, y, r] of this.bumpers) {
          let nx = b.x - x, ny = b.y - y;
          const d = Math.hypot(nx, ny), min = r + BALL_R;
          if (d < min && d > 1e-6) {
            nx /= d; ny /= d;
            b.x = x + nx * min; b.y = y + ny * min;
            const vn = b.vx * nx + b.vy * ny;
            if (vn < 0) { b.vx -= 2.1 * vn * nx; b.vy -= 2.1 * vn * ny; }
          }
        }
        for (const bar of this.bars) {
          const [ax, ay, bx, by] = this.barEnds(bar, tt);
          const w = bar[3];
          // Velocity of the bar at the closest point (rotation about its centre).
          const px = b.x - bar[0], py = b.y - bar[1];
          segPush(b, ax, ay, bx, by, BALL_R + 5, 0.6, -w * py, w * px);
        }
      }
    }

    for (const b of balls) {
      const inSand = this.sand.some(([x, y, r]) => (b.x - x) ** 2 + (b.y - y) ** 2 < r * r);
      const f = Math.pow(inSand ? 0.9 : 0.982, dt * 60);
      b.vx *= f; b.vy *= f;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp < 5) { b.vx = 0; b.vy = 0; }

      if (this.water.some(([x, y, r]) => (b.x - x) ** 2 + (b.y - y) ** 2 < (r - 3) ** 2)) {
        this.events.push({ k: 'splash', by: b.pid, x: b.x, y: b.y });
        b.x = b.lastX; b.y = b.lastY; b.vx = 0; b.vy = 0; b.strokes++;
      }

      const dh = Math.hypot(b.x - this.hole[0], b.y - this.hole[1]);
      if (dh < HOLE_R) {
        if (sp < 330) {
          this.sink(b, Math.max(1, 6 - b.strokes));
          continue;
        }
        // Too fast: the hole tugs the ball slightly sideways (lip-out).
        b.vx += (this.hole[0] - b.x) * 2; b.vy += (this.hole[1] - b.y) * 2;
      } else if (dh < HOLE_R * 2.2 && sp < 120 && sp > 0) {
        // Gentle pull near the cup.
        b.vx += (this.hole[0] - b.x) * 0.6; b.vy += (this.hole[1] - b.y) * 0.6;
      }
      if (b.strokes >= MAX_STROKES && sp === 0 && !b.aim) this.sink(b, 0);
      b.rx = b.x; b.ry = b.y;
    }
  }

  sink(b, pts) {
    b.holed = true;
    b.vx = 0; b.vy = 0;
    b.x = this.hole[0]; b.y = this.hole[1];
    b.aim = null;
    this.events.push({ k: 'point', by: b.pid, x: this.hole[0], y: this.hole[1], ring: '#ffffff', pts, sfx: 'hole', text: pts ? `+${pts}` : 'Maks pukulan' });
  }

  get done() {
    return this.balls.size > 0 && [...this.balls.values()].every((b) => b.holed);
  }

  progress() {
    const all = [...this.balls.values()];
    return { done: all.filter((b) => b.holed).length, total: all.length };
  }

  applyEvent() {}

  describe() {
    return { ...this.def, time: this.time, balls: [...this.balls.values()].map((b) => [b.pid, Math.round(b.x), Math.round(b.y), b.strokes, b.holed ? 1 : 0]) };
  }

  snapshot() {
    const bl = [];
    for (const b of this.balls.values()) bl.push(b.pid, Math.round(b.x * 4), Math.round(b.y * 4), b.holed ? 1 : 0, b.strokes, b.aim ? 1 : 0, Math.round(b.ax), Math.round(b.ay));
    return { bl };
  }

  applySnapshot(msg) {
    if (!Array.isArray(msg.bl)) return;
    const seen = new Set();
    for (let i = 0; i + 7 < msg.bl.length; i += 8) {
      const pid = msg.bl[i];
      let b = this.balls.get(pid);
      if (!b) b = this.addBall(pid, msg.bl[i + 1] / 4, msg.bl[i + 2] / 4);
      seen.add(pid);
      b.x = msg.bl[i + 1] / 4; b.y = msg.bl[i + 2] / 4;
      b.holed = !!msg.bl[i + 3];
      b.strokes = msg.bl[i + 4] | 0;
      b.aim = msg.bl[i + 5] ? {} : null;
      b.ax = +msg.bl[i + 6]; b.ay = +msg.bl[i + 7];
    }
    for (const pid of [...this.balls.keys()]) if (!seen.has(pid)) this.balls.delete(pid);
  }

  clientTick(dt) {
    const k = 1 - Math.exp(-dt * 20);
    for (const b of this.balls.values()) { b.rx += (b.x - b.rx) * k; b.ry += (b.y - b.ry) * k; }
  }
}

export default {
  id: 'golf',
  name: 'Golf Mini',
  icon: '⛳',
  ui: { tools: false, rotate: 'camera', view: true },
  hint: 'Tarik ke belakang seperti ketapel lalu lepas. ⟲ ⟳ / Q E / 2 jari = putar kamera, 🗺️ = lihat seluruh lapangan',
  makeDef,
  create: (def) => new GolfWorld(def),
  hud(w, myId) {
    const pr = w.progress();
    const me = w.balls.get(myId);
    const mine = me ? (me.holed ? 'Bolamu sudah masuk ✅' : `Pukulanmu: ${me.strokes}`) : '';
    return { count: `${pr.done} / ${pr.total} masuk`, sub: `Golf · par ${w.par}${mine ? ' · ' + mine : ''}` };
  },
};

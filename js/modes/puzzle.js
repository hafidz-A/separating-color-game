// Mode: Pasang Puzzle — co-op jigsaw. Drag pieces into the frame; on later
// levels pieces arrive rotated and must be turned before they fit.
import { mulberry32 } from '../levels.js';

const GRIDS = [[3, 2], [3, 3], [4, 3], [4, 4], [5, 4], [6, 4], [6, 5], [7, 5], [7, 6], [8, 6]];
export const PIECE = 110; // piece size in world units
export const PIC_STYLES = 5;

export function makeDef(n, seed) {
  const rng = mulberry32(seed * 31 + n * 977);
  const [cols, rows] = GRIDS[Math.min(n - 1, GRIDS.length - 1)];
  const picW = cols * PIECE, picH = rows * PIECE;
  const mx = Math.max(200, PIECE * 2.1), my = Math.max(150, PIECE * 1.55);
  const W = Math.round(picW + mx * 2), H = Math.round(picH + my * 2);
  const fx = Math.round((W - picW) / 2), fy = Math.round((H - picH) / 2);
  const rot = n >= 5;

  // Tabs: +1 bulges toward +x / +y, -1 the other way.
  const hTabs = []; // between row r-1 and r, for r = 1..rows-1
  for (let r = 1; r < rows; r++) { hTabs[r] = []; for (let c = 0; c < cols; c++) hTabs[r][c] = rng() < 0.5 ? 1 : -1; }
  const vTabs = []; // between col c-1 and c
  for (let r = 0; r < rows; r++) { vTabs[r] = []; for (let c = 1; c < cols; c++) vTabs[r][c] = rng() < 0.5 ? 1 : -1; }

  const pieces = [];
  const margin = PIECE * 0.65;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let x = 0, y = 0;
      for (let k = 0; k < 60; k++) {
        x = margin + rng() * (W - margin * 2);
        y = margin + rng() * (H - margin * 2);
        const inFrame = x > fx - PIECE * 0.7 && x < fx + picW + PIECE * 0.7 && y > fy - PIECE * 0.7 && y < fy + picH + PIECE * 0.7;
        if (!inFrame) break;
      }
      pieces.push([pieces.length, c, r, Math.round(x), Math.round(y), rot ? Math.floor(rng() * 4) : 0, 0]);
    }
  }
  // Shuffle draw order so neighbouring pieces are not stacked in order.
  for (let i = pieces.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pieces[i], pieces[j]] = [pieces[j], pieces[i]]; }

  return {
    mode: 'puzzle', n, seed, W, H, cols, rows, picW, picH, fx, fy, rot,
    style: Math.floor(rng() * PIC_STYLES), picSeed: Math.floor(rng() * 1e9),
    hTabs, vTabs, pieces, time: 0,
  };
}

class PuzzleWorld {
  constructor(def) {
    this.mode = 'puzzle';
    this.def = def;
    Object.assign(this, { n: def.n, W: def.W, H: def.H, cols: def.cols, rows: def.rows, picW: def.picW, picH: def.picH, fx: def.fx, fy: def.fy, rot: def.rot });
    this.time = def.time || 0;
    this.z = 0;
    this.pieces = def.pieces.map(([id, c, r, x, y, q, placed]) => ({
      id, c, r, x, y, q: q | 0, placed: !!placed, holder: -1, z: this.z++,
      tx: def.fx + (c + 0.5) * PIECE, ty: def.fy + (r + 0.5) * PIECE,
      rx: x, ry: y, rq: (q | 0) * Math.PI / 2,
    }));
    this.byId = new Map(this.pieces.map((p) => [p.id, p]));
    this.tools = new Map();
    this.events = [];
  }

  tool(pid) {
    let t = this.tools.get(pid);
    if (!t) {
      t = { pid, x: this.W / 2, y: this.H / 2, a: 0, kind: 'hand', down: false, seen: 0, q: null, held: -1, ox: 0, oy: 0, wasDown: false };
      this.tools.set(pid, t);
    }
    return t;
  }

  join(pid) { this.tool(pid); }

  leave(pid) {
    const t = this.tools.get(pid);
    if (t && t.held >= 0) { const p = this.byId.get(t.held); if (p) p.holder = -1; }
    this.tools.delete(pid);
  }

  setInput(pid, inp) {
    const t = this.tool(pid);
    t.seen = 1;
    t.x = Math.max(0, Math.min(this.W, +inp.x || 0));
    t.y = Math.max(0, Math.min(this.H, +inp.y || 0));
    t.down = !!inp.d;
    const q = inp.q | 0;
    if (t.q === null) t.q = q;
    else if (q !== t.q) {
      const steps = ((q - t.q) % 4 + 4) % 4;
      t.q = q;
      this.turn(t, steps);
    }
  }

  turn(t, steps) {
    if (!this.rot || !steps) return;
    let p = t.held >= 0 ? this.byId.get(t.held) : this.pick(t.x, t.y);
    if (!p || p.placed || (p.holder >= 0 && p.holder !== t.pid)) return;
    p.q = (p.q + steps) % 4;
    p.z = ++this.z;
  }

  pick(x, y) {
    let best = null;
    for (const p of this.pieces) {
      if (p.placed || p.holder >= 0) continue;
      if (Math.abs(p.x - x) < PIECE * 0.55 && Math.abs(p.y - y) < PIECE * 0.55 && (!best || p.z > best.z)) best = p;
    }
    return best;
  }

  step(dt) {
    this.time += dt;
    for (const t of this.tools.values()) {
      if (t.down && !t.wasDown) {
        const p = this.pick(t.x, t.y);
        if (p) { p.holder = t.pid; p.z = ++this.z; t.held = p.id; t.ox = p.x - t.x; t.oy = p.y - t.y; }
      }
      const p = t.held >= 0 ? this.byId.get(t.held) : null;
      if (p) {
        p.x = Math.max(PIECE * 0.3, Math.min(this.W - PIECE * 0.3, t.x + t.ox));
        p.y = Math.max(PIECE * 0.3, Math.min(this.H - PIECE * 0.3, t.y + t.oy));
        // Ease the grab offset away so the piece settles under the finger.
        t.ox *= 0.9; t.oy *= 0.9;
        if (!t.down) {
          p.holder = -1;
          t.held = -1;
          if (p.q === 0 && Math.abs(p.x - p.tx) < PIECE * 0.28 && Math.abs(p.y - p.ty) < PIECE * 0.28) {
            p.x = p.tx; p.y = p.ty; p.placed = true;
            this.events.push({ k: 'point', by: t.pid, x: p.x, y: p.y, ring: '#ffd36b', pts: 1, sfx: 'snap' });
          }
        }
      }
      t.wasDown = t.down;
    }
    for (const p of this.pieces) { p.rx = p.x; p.ry = p.y; p.rq = p.q * Math.PI / 2; }
  }

  get done() { return this.pieces.every((p) => p.placed); }

  progress() {
    return { done: this.pieces.filter((p) => p.placed).length, total: this.pieces.length };
  }

  applyEvent() {}

  describe() {
    return { ...this.def, time: this.time, pieces: this.pieces.map((p) => [p.id, p.c, p.r, Math.round(p.x), Math.round(p.y), p.q, p.placed ? 1 : 0]) };
  }

  snapshot() {
    const ps = [];
    for (const p of this.pieces) ps.push(p.id, Math.round(p.x), Math.round(p.y), p.q, p.placed ? 2 : p.holder >= 0 ? 1 : 0);
    return { ps };
  }

  applySnapshot(msg) {
    if (!Array.isArray(msg.ps)) return;
    for (let i = 0; i + 4 < msg.ps.length; i += 5) {
      const p = this.byId.get(msg.ps[i]);
      if (!p) continue;
      p.x = +msg.ps[i + 1]; p.y = +msg.ps[i + 2]; p.q = msg.ps[i + 3] & 3;
      const st = msg.ps[i + 4] | 0;
      p.placed = st === 2;
      p.holder = st === 1 ? 1 : -1;
      if (st === 1) p.z = Math.max(p.z, ++this.z);
    }
  }

  clientTick(dt) {
    const k = 1 - Math.exp(-dt * 18);
    for (const p of this.pieces) {
      p.rx += (p.x - p.rx) * k;
      p.ry += (p.y - p.ry) * k;
      let da = p.q * Math.PI / 2 - p.rq;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      p.rq += da * k;
    }
  }
}

export default {
  id: 'puzzle',
  name: 'Pasang Puzzle',
  icon: '🧩',
  ui: { tools: false, rotate: 'step' },
  hint: 'Tahan & geser kepingan ke bingkai. Putar dulu kalau miring (⟲ ⟳ / Q E / scroll)',
  makeDef,
  create: (def) => new PuzzleWorld(def),
  hud(w) {
    const pr = w.progress();
    return { count: `${pr.done} / ${pr.total}`, sub: `Puzzle ${w.cols}×${w.rows}${w.rot ? ' · ada yang miring' : ''}` };
  },
};

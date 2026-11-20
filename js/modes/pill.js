// Mode: Pilah Pil — push or pick up pills into trays of the same colour.
import { makeLevel, PILL_COLORS } from '../levels.js';
import { World } from '../sim.js';

class PillWorld extends World {
  constructor(def) {
    super(def);
    this.mode = 'pill';
  }

  join(pid) { this.tool(pid); }
  leave(pid) { this.removeTool(pid); }

  step(dt) {
    super.step(dt);
    // Translate pill events into the shared event shape.
    this.events = this.events.map((ev) => (ev.k === 'sort'
      ? { k: 'point', by: ev.by, x: ev.x, y: ev.y, ring: PILL_COLORS[ev.c].hex, pts: 1, sfx: 'pop', c: ev.c, ti: ev.ti }
      : ev));
  }

  applyEvent(ev) {
    const tr = this.trays[ev.ti];
    if (!tr) return;
    if (ev.k === 'point') tr.flash = 0.35;
    if (ev.k === 'nope') tr.nope = 0.4;
  }

  progress() { return { done: this.sorted, total: this.total }; }

  describe() { return { ...super.describe(), mode: 'pill' }; }

  snapshot() {
    const alive = this.pills.filter((p) => p.alive);
    const buf = new Int16Array(alive.length * 4);
    alive.forEach((p, i) => {
      let a = p.a % (Math.PI * 2);
      if (a > Math.PI) a -= Math.PI * 2;
      if (a < -Math.PI) a += Math.PI * 2;
      buf[i * 4] = p.id | (p.held >= 0 ? 0x4000 : 0);
      buf[i * 4 + 1] = Math.round(p.x * 8);
      buf[i * 4 + 2] = Math.round(p.y * 8);
      buf[i * 4 + 3] = Math.round(a * 10000);
    });
    return { b: buf.buffer, sorted: this.sorted, tc: this.trays.map((t) => t.count) };
  }

  applySnapshot(msg) {
    this.sorted = msg.sorted | 0;
    if (Array.isArray(msg.tc)) msg.tc.forEach((c, i) => { if (this.trays[i]) this.trays[i].count = c | 0; });
    let raw = msg.b;
    if (raw && ArrayBuffer.isView(raw)) raw = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    if (!(raw instanceof ArrayBuffer)) return;
    const buf = new Int16Array(raw);
    for (const p of this.pills) p.seen = false;
    for (let i = 0; i + 3 < buf.length; i += 4) {
      const p = this.byId.get(buf[i] & 0x3fff);
      if (!p) continue;
      p.seen = true;
      p.held = buf[i] & 0x4000 ? 1 : -1;
      p.x = buf[i + 1] / 8;
      p.y = buf[i + 2] / 8;
      p.a = buf[i + 3] / 10000;
    }
    for (const p of this.pills) if (!p.seen) p.alive = false;
  }

  clientTick(dt) {
    this.updateTrays();
    const k = 1 - Math.exp(-dt * 18);
    for (const p of this.pills) {
      if (!p.alive) continue;
      p.rx += (p.x - p.rx) * k;
      p.ry += (p.y - p.ry) * k;
      let da = p.a - p.ra;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      p.ra += da * k;
    }
    for (const tr of this.trays) { tr.flash = Math.max(0, tr.flash - dt); tr.nope = Math.max(0, tr.nope - dt); }
  }
}

export default {
  id: 'pill',
  name: 'Pilah Pil',
  icon: '💊',
  ui: { tools: true, rotate: 'smooth' },
  hint: 'Tahan & geser untuk mendorong pil ke wadah yang warnanya sama',
  makeDef: (n, seed) => ({ ...makeLevel(n, seed), mode: 'pill' }),
  create: (def) => new PillWorld(def),
  hud(w) {
    return { count: `${w.sorted} / ${w.total}`, sub: `${w.trays.length} warna` };
  },
};

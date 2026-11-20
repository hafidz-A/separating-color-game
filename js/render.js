import { PILL_COLORS, PILL_R, mulberry32 } from './levels.js';
import { SPATULA_HALF, SPATULA_THICK, GRAB_R } from './sim.js';

const BOARD = '#232a42';
const BOARD_EDGE = '#2f3858';
const GRID = 'rgba(255,255,255,0.045)';
const GRID_MAJOR = 'rgba(255,255,255,0.08)';

function lighten(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (v) => Math.round(v + (255 - v) * amt);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

const LIGHT = PILL_COLORS.map((c) => lighten(c.hex, 0.55));

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawPill(ctx, x, y, a, c, shape, scale = 1, shadow = true) {
  const col = PILL_COLORS[c];
  const R = PILL_R * scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  if (shape === 1) {
    const L = R * 0.98, Wd = R * 0.6;
    if (shadow) {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      roundRect(ctx, -L + 1.5, -Wd + 2.5, L * 2, Wd * 2, Wd);
      ctx.fill();
    }
    ctx.save();
    roundRect(ctx, -L, -Wd, L * 2, Wd * 2, Wd);
    ctx.clip();
    ctx.fillStyle = col.hex;
    ctx.fillRect(-L, -Wd, L, Wd * 2);
    ctx.fillStyle = LIGHT[c];
    ctx.fillRect(0, -Wd, L, Wd * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(-L * 0.75, -Wd * 0.62, L * 1.5, Wd * 0.35);
    ctx.restore();
    ctx.strokeStyle = col.deep;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    roundRect(ctx, -L, -Wd, L * 2, Wd * 2, Wd);
    ctx.stroke();
  } else {
    const r = R * 0.9;
    if (shadow) {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.arc(1.5, 2.5, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = col.hex;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = col.deep;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.62, 0);
    ctx.lineTo(r * 0.62, 0);
    ctx.stroke();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(-r * 0.3, -r * 0.42, r * 0.32, r * 0.16, -0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function hash3(a, b, c) {
  return mulberry32(a * 73856093 ^ b * 19349663 ^ c * 83492791);
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1;
    this.ox = 0;
    this.oy = 0;
    this.inset = { top: 70, right: 16, bottom: 70, left: 16 };
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    this.dpr = dpr;
    this.cw = w;
    this.ch = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  fit(world) {
    const { top, right, bottom, left } = this.inset;
    const aw = Math.max(100, this.cw - left - right);
    const ah = Math.max(100, this.ch - top - bottom);
    this.scale = Math.min(aw / world.W, ah / world.H);
    this.ox = left + (aw - world.W * this.scale) / 2;
    this.oy = top + (ah - world.H * this.scale) / 2;
  }

  toWorld(sx, sy) {
    return { x: (sx - this.ox) / this.scale, y: (sy - this.oy) / this.scale };
  }

  draw(world, view) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cw, this.ch);
    if (!world) return;
    this.fit(world);
    ctx.translate(this.ox, this.oy);
    ctx.scale(this.scale, this.scale);

    this.drawBoard(world);
    for (let i = 0; i < world.trays.length; i++) this.drawTray(world, world.trays[i], i, view.now);
    this.drawObstacles(world);

    for (const p of world.pills) {
      if (!p.alive || p.held >= 0) continue;
      drawPill(ctx, p.rx, p.ry, p.ra, p.c, p.shape);
    }
    for (const fx of view.fx) this.drawFx(fx, view.now);
    // Tools sit above the table; lifted pills are drawn above their tool.
    for (const t of view.tools) this.drawTool(t, view);
    for (const p of world.pills) {
      if (!p.alive || p.held < 0) continue;
      drawPill(ctx, p.rx, p.ry - 4, p.ra, p.c, p.shape, 1.08);
    }
    for (const t of view.tools) this.drawTags(t, view);
    for (const e of view.emotes) this.drawEmote(e, view.now);
  }

  drawBoard(world) {
    const ctx = this.ctx;
    const { W, H } = world;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(ctx, 6, 10, W, H, 22);
    ctx.fill();
    ctx.fillStyle = BOARD;
    roundRect(ctx, 0, 0, W, H, 22);
    ctx.fill();
    ctx.save();
    roundRect(ctx, 0, 0, W, H, 22);
    ctx.clip();
    ctx.lineWidth = 1 / this.scale;
    for (let x = 40, i = 1; x < W; x += 40, i++) {
      ctx.strokeStyle = i % 5 === 0 ? GRID_MAJOR : GRID;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 40, i = 1; y < H; y += 40, i++) {
      ctx.strokeStyle = i % 5 === 0 ? GRID_MAJOR : GRID;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = BOARD_EDGE;
    ctx.lineWidth = 4;
    roundRect(ctx, 0, 0, W, H, 22);
    ctx.stroke();
  }

  drawTray(world, tr, ti, now) {
    const ctx = this.ctx;
    const col = PILL_COLORS[tr.c];
    const shake = tr.nope > 0 ? Math.sin(now / 25) * 4 * (tr.nope / 0.4) : 0;
    const x = tr.x + shake, y = tr.y;
    ctx.save();
    ctx.globalAlpha = 0.17 + tr.flash * 0.6;
    ctx.fillStyle = col.hex;
    roundRect(ctx, x, y, tr.w, tr.h, 18);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = tr.nope > 0 ? '#ff5d6c' : col.hex;
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    roundRect(ctx, x + 1.5, y + 1.5, tr.w - 3, tr.h - 3, 17);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Sorted pills pile up inside the tray.
    const shown = Math.min(tr.count, 90);
    for (let k = 0; k < shown; k++) {
      const rng = hash3(ti + 1, k + 1, tr.c + 7);
      const px = x + 16 + rng() * (tr.w - 32);
      const py = y + 16 + rng() * (tr.h - 32);
      ctx.globalAlpha = 0.85;
      drawPill(ctx, px, py, rng() * 6.28, tr.c, tr.c % 2, 0.85, false);
    }
    ctx.globalAlpha = 1;

    const per = Math.round(world.total / world.trays.length);
    const label = `${tr.count}/${per}`;
    ctx.font = '600 15px Fredoka, system-ui, sans-serif';
    const tw = ctx.measureText(label).width + 38;
    const lx = x + tr.w / 2 - tw / 2;
    const ly = y + tr.h / 2 - 13;
    ctx.fillStyle = 'rgba(20,24,40,0.72)';
    roundRect(ctx, lx, ly, tw, 26, 13);
    ctx.fill();
    drawPill(ctx, lx + 14, ly + 13, 0, tr.c, tr.c % 2, 0.75, false);
    ctx.fillStyle = tr.count >= per ? col.hex : '#f3f0ff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, lx + 28, ly + 14);
  }

  drawObstacles(world) {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    for (const o of world.obs) {
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = o.r * 2;
      ctx.beginPath(); ctx.moveTo(o.x1 + 3, o.y1 + 5); ctx.lineTo(o.x2 + 3, o.y2 + 5); ctx.stroke();
      ctx.strokeStyle = '#4a5580';
      ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(o.x1, o.y1 - 4); ctx.lineTo(o.x2, o.y2 - 4); ctx.stroke();
    }
  }

  drawTool(t, view) {
    const ctx = this.ctx;
    const color = t.color;
    ctx.save();
    ctx.translate(t.x, t.y);
    if (t.kind === 'grab') {
      ctx.globalAlpha = t.down ? 0.95 : 0.6;
      if (t.down) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.14;
        ctx.beginPath(); ctx.arc(0, 0, GRAB_R, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.95;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.setLineDash(t.down ? [] : [7, 6]);
      ctx.beginPath(); ctx.arc(0, 0, GRAB_R, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      const pinch = t.down ? 5 : 12;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-pinch, -6); ctx.lineTo(-pinch - 10, -GRAB_R - 18);
      ctx.moveTo(pinch, -6); ctx.lineTo(pinch + 10, -GRAB_R - 18);
      ctx.stroke();
    } else {
      ctx.rotate(t.a);
      const lift = t.down ? 0 : 8;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      roundRect(ctx, -SPATULA_HALF + 3 + lift, -SPATULA_THICK + 4 + lift, SPATULA_HALF * 2, SPATULA_THICK * 2, SPATULA_THICK);
      ctx.fill();
      ctx.globalAlpha = t.down ? 1 : 0.55;
      ctx.fillStyle = color;
      roundRect(ctx, -SPATULA_HALF, -SPATULA_THICK, SPATULA_HALF * 2, SPATULA_THICK * 2, SPATULA_THICK);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      roundRect(ctx, -SPATULA_HALF + 6, -SPATULA_THICK + 2, SPATULA_HALF * 2 - 12, 3, 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(20,24,40,0.55)';
      ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  drawTags(t, view) {
    const ctx = this.ctx;
    const s = 1 / Math.max(this.scale, 0.35);
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(s, s);
    ctx.font = '600 13px Fredoka, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const name = t.me ? `${t.name} (kamu)` : t.name;
    const w = ctx.measureText(name).width + 16;
    const ty = (t.kind === 'grab' ? -GRAB_R : -26) / s - 30;
    if (!t.me || view.showOwnTag) {
      ctx.fillStyle = t.color;
      roundRect(ctx, -w / 2, ty, w, 22, 11);
      ctx.fill();
      ctx.fillStyle = '#16192a';
      ctx.fillText(name, -w / 2 + 8, ty + 11.5);
    }
    if (t.bubble && view.now < t.bubble.until) {
      ctx.font = '500 14px Fredoka, system-ui, sans-serif';
      const lines = wrapText(ctx, t.bubble.text, 200);
      const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20;
      const bh = lines.length * 18 + 12;
      const by = ty - bh - 8;
      ctx.globalAlpha = Math.min(1, (t.bubble.until - view.now) / 400);
      ctx.fillStyle = '#fffaf2';
      roundRect(ctx, -bw / 2, by, bw, bh, 12);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-6, by + bh); ctx.lineTo(6, by + bh); ctx.lineTo(0, by + bh + 7); ctx.fill();
      ctx.fillStyle = '#1d2033';
      lines.forEach((l, i) => ctx.fillText(l, -bw / 2 + 10, by + 15 + i * 18));
    }
    ctx.restore();
  }

  drawFx(fx, now) {
    const ctx = this.ctx;
    const age = (now - fx.t0) / 900;
    if (age >= 1) return;
    ctx.save();
    ctx.globalAlpha = 1 - age;
    ctx.strokeStyle = PILL_COLORS[fx.c].hex;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, 8 + age * 30, 0, Math.PI * 2);
    ctx.stroke();
    if (fx.color) {
      const s = 1 / Math.max(this.scale, 0.35);
      ctx.translate(fx.x, fx.y - 14 - age * 40);
      ctx.scale(s, s);
      ctx.font = '700 16px Fredoka, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = fx.color;
      ctx.fillText('+1', 0, 0);
    }
    ctx.restore();
  }

  drawEmote(e, now) {
    const ctx = this.ctx;
    const age = (now - e.t0) / 1600;
    if (age >= 1) return;
    const s = 1 / Math.max(this.scale, 0.35);
    ctx.save();
    ctx.globalAlpha = age < 0.7 ? 1 : 1 - (age - 0.7) / 0.3;
    ctx.translate(e.x + Math.sin(age * 9 + e.x) * 8, e.y - 40 - age * 90);
    ctx.scale(s, s);
    ctx.font = '34px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(e.e, 0, 0);
    ctx.restore();
  }
}

function wrapText(ctx, text, maxW) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

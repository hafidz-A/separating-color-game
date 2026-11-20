// 3D view for "Pasang Puzzle": a warm wooden table, a frame showing a faint
// ghost of the picture, and real jigsaw pieces cut from a generated picture.
import * as THREE from '../vendor/three.module.min.js';
import { toyMaterial, roundRectShape, roundRectPath, slab } from '../render3d.js';
import { PIECE } from '../modes/puzzle.js';
import { mulberry32 } from '../levels.js';
import { PHOTOS } from '../photos.js';

const KNOB = [[0.35, 0], [0.37, 0.05], [0.34, 0.12], [0.36, 0.2], [0.43, 0.25], [0.5, 0.26], [0.57, 0.25], [0.64, 0.2], [0.66, 0.12], [0.63, 0.05], [0.65, 0]];
const PIECE_TOP = 6;

// ---------- generated pictures (same on every device: seeded) ----------
const PALETTES = [
  ['#ff9ec7', '#ffd36b', '#8fe3c4', '#9cc8ff', '#c7a6ff', '#fff3e0'],
  ['#ff7b7b', '#ffb36b', '#ffe27a', '#7fd8a8', '#6bb8ff', '#f8f0ff'],
  ['#5a4fcf', '#ff88c8', '#ffd76a', '#6be0d0', '#ffffff', '#2b2560'],
  ['#ffb5a7', '#fcd5ce', '#f8edeb', '#d8e2dc', '#9d8189', '#ffe5d9'],
  ['#2ec4b6', '#ff9f1c', '#ffbf69', '#cbf3f0', '#ff6b8b', '#fdfffc'],
];

function heartPath(g, x, y, s) {
  g.beginPath();
  g.moveTo(x, y + s * 0.3);
  g.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
  g.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.8, x, y + s);
  g.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
  g.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3);
  g.fill();
}

function starPath(g, x, y, r) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

export function paintPicture(w, h, style, seed) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const rng = mulberry32(seed);
  const pal = PALETTES[Math.floor(rng() * PALETTES.length)];
  const pick = () => pal[Math.floor(rng() * (pal.length - 1))];
  const s = Math.min(w, h);

  if (style === 0) { // sunset hills
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, pal[3]); sky.addColorStop(0.6, pal[0]); sky.addColorStop(1, pal[1]);
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff6c9'; g.beginPath(); g.arc(w * (0.2 + rng() * 0.6), h * 0.35, s * 0.13, 0, 7); g.fill();
    for (let k = 0; k < 4; k++) {
      g.fillStyle = pal[(k + 2) % 5];
      g.globalAlpha = 0.75 + k * 0.08;
      g.beginPath(); g.moveTo(0, h);
      const base = h * (0.5 + k * 0.12);
      for (let x = 0; x <= w; x += w / 40) g.lineTo(x, base + Math.sin(x / w * (3 + k) * Math.PI + k * 2 + rng()) * h * 0.06);
      g.lineTo(w, h); g.fill();
    }
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (let k = 0; k < 4; k++) { const x = rng() * w, y = rng() * h * 0.3; for (let j = 0; j < 4; j++) { g.beginPath(); g.arc(x + j * s * 0.04, y + (j % 2) * s * 0.015, s * 0.035, 0, 7); g.fill(); } }
  } else if (style === 1) { // hearts
    g.fillStyle = pal[5]; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 6; k++) { g.fillStyle = pal[k % 5]; g.globalAlpha = 0.25; g.fillRect(0, (k / 6) * h, w, h / 12); }
    g.globalAlpha = 1;
    const n = Math.round(w * h / (s * s) * 14);
    for (let k = 0; k < n; k++) { g.fillStyle = pick(); heartPath(g, rng() * w, rng() * h - s * 0.1, s * (0.08 + rng() * 0.16)); }
  } else if (style === 2) { // night sky
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#1d1a4a'); sky.addColorStop(1, pal[0]);
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff5c4'; g.beginPath(); g.arc(w * (0.15 + rng() * 0.7), h * 0.28, s * 0.12, 0, 7); g.fill();
    for (let k = 0; k < 70; k++) { g.fillStyle = k % 3 ? '#ffffff' : pal[2]; starPath(g, rng() * w, rng() * h * 0.7, s * (0.008 + rng() * 0.03)); }
    g.fillStyle = '#2c2763';
    g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += w / 12) g.lineTo(x, h * (0.72 + rng() * 0.15));
    g.lineTo(w, h); g.fill();
  } else if (style === 3) { // flower garden
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#d8f6ff'); bg.addColorStop(0.45, '#d8f6ff'); bg.addColorStop(0.46, '#9be29b'); bg.addColorStop(1, '#5cc77a');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 45; k++) {
      const x = rng() * w, y = h * 0.42 + rng() * h * 0.58, r = s * (0.025 + rng() * 0.045);
      g.strokeStyle = '#3a9a55'; g.lineWidth = r * 0.25; g.beginPath(); g.moveTo(x, y); g.lineTo(x, Math.min(h, y + r * 4)); g.stroke();
      g.fillStyle = pick();
      for (let j = 0; j < 6; j++) { const a = j * Math.PI / 3; g.beginPath(); g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.75, 0, 7); g.fill(); }
      g.fillStyle = '#ffe066'; g.beginPath(); g.arc(x, y, r * 0.6, 0, 7); g.fill();
    }
    for (let k = 0; k < 3; k++) { g.fillStyle = 'rgba(255,255,255,0.9)'; const x = rng() * w, y = rng() * h * 0.25; g.beginPath(); g.arc(x, y, s * 0.05, 0, 7); g.arc(x + s * 0.05, y, s * 0.06, 0, 7); g.arc(x + s * 0.1, y, s * 0.045, 0, 7); g.fill(); }
  } else { // candy shapes
    g.fillStyle = pal[5]; g.fillRect(0, 0, w, h);
    const stripe = s * 0.09;
    g.save(); g.rotate(-0.5);
    for (let x = -h; x < w + h; x += stripe * 2) { g.fillStyle = pal[Math.floor((x / stripe / 2 % 5 + 5) % 5)]; g.globalAlpha = 0.35; g.fillRect(x, -h, stripe, h * 3); }
    g.restore(); g.globalAlpha = 1;
    for (let k = 0; k < 26; k++) {
      g.fillStyle = pick();
      const x = rng() * w, y = rng() * h, r = s * (0.04 + rng() * 0.08);
      const kind = k % 3;
      if (kind === 0) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.3, 0, 7); g.fill(); }
      else if (kind === 1) starPath(g, x, y, r * 1.2);
      else heartPath(g, x, y - r, r * 2);
    }
  }
  // A soft vignette so edges and centre look different.
  const vg = g.createRadialGradient(w / 2, h / 2, s * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(255,255,255,0)'); vg.addColorStop(1, 'rgba(60,30,80,0.18)');
  g.fillStyle = vg; g.fillRect(0, 0, w, h);
  return c;
}

function woodTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#d9a46b'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 32) {
    g.fillStyle = y % 64 ? '#d39b60' : '#dcab74';
    g.fillRect(0, y, 256, 30);
    g.fillStyle = 'rgba(120,70,30,0.25)'; g.fillRect(0, y + 30, 256, 2);
  }
  g.strokeStyle = 'rgba(140,85,40,0.18)'; g.lineWidth = 2;
  for (let k = 0; k < 18; k++) { const y = (k * 37) % 256; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(80, y + 6, 170, y - 6, 256, y + 3); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 260, 1 / 260);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Jigsaw outline of one piece, in picture coordinates.
function pieceShape(world, c, r) {
  const S = PIECE;
  const x0 = c * S, y0 = r * S;
  const { cols, rows } = world;
  const h = world.def.hTabs, v = world.def.vTabs;
  const shape = new THREE.Shape();
  const edge = (ax, ay, bx, by, nx, ny, sgn) => {
    if (!sgn) { shape.lineTo(bx, by); return; }
    const pts = KNOB.map(([t, hh]) => new THREE.Vector2(ax + (bx - ax) * t + nx * sgn * hh * S, ay + (by - ay) * t + ny * sgn * hh * S));
    shape.lineTo(pts[0].x, pts[0].y);
    shape.splineThru(pts.slice(1));
    shape.lineTo(bx, by);
  };
  shape.moveTo(x0, y0);
  edge(x0, y0, x0 + S, y0, 0, 1, r > 0 ? h[r][c] : 0);
  edge(x0 + S, y0, x0 + S, y0 + S, 1, 0, c < cols - 1 ? v[r][c + 1] : 0);
  edge(x0 + S, y0 + S, x0, y0 + S, 0, 1, r < rows - 1 ? h[r + 1][c] : 0);
  edge(x0, y0 + S, x0, y0, 1, 0, c > 0 ? v[r][c] : 0);
  return shape;
}

export class PuzzleScene {
  build(world, core) {
    const { W, H, picW, picH, fx, fy } = world;
    const g = core.levelGroup;

    // Table
    const table = new THREE.Mesh(
      slab(roundRectShape(-W / 2, -H / 2, W, H, 34), 24, 0, 6),
      [new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.75 }), new THREE.MeshStandardMaterial({ color: '#a8703f', roughness: 0.8 })],
    );
    table.receiveShadow = true;
    table.castShadow = true;
    g.add(table);

    // Picture texture shared by the pieces and the ghost in the frame.
    const k = Math.min(2, 1800 / Math.max(picW, picH));
    const canvas = paintPicture(Math.round(picW * k), Math.round(picH * k), world.def.style, world.def.picSeed);
    const pieceTex = new THREE.CanvasTexture(canvas);
    pieceTex.colorSpace = THREE.SRGBColorSpace;
    pieceTex.anisotropy = 4;
    pieceTex.repeat.set(1 / picW, -1 / picH);
    pieceTex.offset.set(0, 1);
    const ghostTex = new THREE.CanvasTexture(canvas);
    ghostTex.colorSpace = THREE.SRGBColorSpace;

    // A real photo, when one is listed: draw it over the generated picture
    // (cropped to fill the frame) as soon as it has loaded.
    const photo = PHOTOS[world.def.photo];
    if (photo) {
      const img = new Image();
      img.onload = () => {
        if (this.world !== world) return;
        const g2 = canvas.getContext('2d');
        const cw = canvas.width, ch = canvas.height;
        const s = Math.max(cw / img.width, ch / img.height);
        const w = img.width * s, h = img.height * s;
        g2.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
        pieceTex.needsUpdate = true;
        ghostTex.needsUpdate = true;
      };
      img.src = 'img/puzzle/' + encodeURIComponent(photo.file);
    }

    // Frame
    const ox = fx - W / 2, oz = fy - H / 2;
    const border = 18;
    const frameShape = roundRectShape(ox - border, oz - border, picW + border * 2, picH + border * 2, 16);
    frameShape.holes.push(roundRectPath(ox, oz, picW, picH, 4));
    const frame = new THREE.Mesh(slab(frameShape, 6, 7, 2), toyMaterial('#fff6ea'));
    frame.castShadow = true;
    frame.receiveShadow = true;
    const back = new THREE.Mesh(slab(roundRectShape(ox, oz, picW, picH, 4), 2, 0.6, 0), new THREE.MeshStandardMaterial({ color: '#f1e2cf', roughness: 0.9 }));
    back.receiveShadow = true;
    const ghost = new THREE.Mesh(new THREE.PlaneGeometry(picW, picH), new THREE.MeshBasicMaterial({ map: ghostTex, transparent: true, opacity: world.n >= 6 ? 0.12 : 0.26, depthWrite: false }));
    ghost.rotation.x = -Math.PI / 2;
    ghost.position.set(ox + picW / 2, 0.8, oz + picH / 2);
    g.add(frame, back, ghost);

    // Pieces
    const topMat = new THREE.MeshStandardMaterial({ map: pieceTex, roughness: 0.55 });
    const sideMat = new THREE.MeshStandardMaterial({ color: '#f4e4cc', roughness: 0.85 });
    this.meshes = new Map();
    this.rims = new Map();
    for (const p of world.pieces) {
      const geo = new THREE.ExtrudeGeometry(pieceShape(world, p.c, p.r), {
        depth: PIECE_TOP - 2, bevelEnabled: true, bevelThickness: 1, bevelSize: 0.8, bevelSegments: 2, curveSegments: 6,
      });
      geo.rotateX(Math.PI / 2);
      geo.translate(-(p.c + 0.5) * PIECE, PIECE_TOP - 1, -(p.r + 0.5) * PIECE);
      const mesh = new THREE.Mesh(geo, [topMat, sideMat]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      this.meshes.set(p.id, mesh);
      // Glowing rim in the holder's colour, shown while someone carries the piece.
      const rimGeo = new THREE.ShapeGeometry(pieceShape(world, p.c, p.r), 6);
      rimGeo.translate(-(p.c + 0.5) * PIECE, -(p.r + 0.5) * PIECE, 0);
      rimGeo.scale(1.12, 1.12, 1);
      rimGeo.rotateX(Math.PI / 2);
      const rim = new THREE.Mesh(rimGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
      rim.visible = false;
      g.add(rim);
      this.rims.set(p.id, rim);
    }
    this.world = world;
  }

  update(world, view, core, now) {
    const { W, H } = world;
    const order = [...world.pieces].filter((p) => !p.placed && p.holder < 0).sort((a, b) => a.z - b.z);
    const rank = new Map(order.map((p, i) => [p.id, i]));
    for (const p of world.pieces) {
      const m = this.meshes.get(p.id);
      if (!m) continue;
      let y = 0;
      if (p.placed) y = 0.4;
      else if (p.holder >= 0) y = 22;
      else y = 1 + (rank.get(p.id) % 10) * 1.3;
      m.position.set(p.rx - W / 2, y, p.ry - H / 2);
      m.rotation.y = -p.rq;
      const s = p.holder >= 0 ? 1.05 : 1;
      m.scale.set(s, 1, s);
      const rim = this.rims.get(p.id);
      const col = p.holder >= 0 && view.colors ? view.colors.get(p.holder) : null;
      rim.visible = !!col;
      if (col) {
        rim.material.color.set(col);
        rim.position.set(p.rx - W / 2, y + 0.5, p.ry - H / 2);
        rim.rotation.y = -p.rq;
      }
    }

    // Each player's hand: their topper floating over the pointer.
    const anchors = new Map();
    for (const t of view.tools) {
      if (t.x == null || t.seen === 0) continue;
      const mk = core.marker(t.pid, t.color);
      const h = t.down ? 40 : 56;
      core.placeMarker(mk, t.x, h, t.y, now, t.me ? 1.1 : 1);
      mk.ring.visible = true;
      mk.ring.position.set(t.x - W / 2, 3, t.y - H / 2);
      mk.ringMat.opacity = t.down ? 0.95 : 0.45;
      anchors.set(t.pid, new THREE.Vector3(t.x - W / 2, h + 6, t.y - H / 2));
    }
    return anchors;
  }
}

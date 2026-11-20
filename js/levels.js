// Level generator: every level is built from (level number, seed), so the
// host can describe a level to everyone in a single message.

export const PILL_COLORS = [
  { name: 'Pink', hex: '#ff8fb8', deep: '#d4588a' },
  { name: 'Mint', hex: '#7ee6b8', deep: '#3aa97c' },
  { name: 'Kuning', hex: '#ffd76a', deep: '#c99a1e' },
  { name: 'Lavender', hex: '#bba4ff', deep: '#7c62d6' },
  { name: 'Biru', hex: '#78c6ff', deep: '#3a8dcc' },
  { name: 'Peach', hex: '#ffac7d', deep: '#d06f3a' },
  { name: 'Putih', hex: '#f4f1ea', deep: '#a9a49a' },
];

export const PILL_R = 10;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function levelInfo(n) {
  const colors = Math.min(2 + Math.floor((n - 1) / 2), PILL_COLORS.length);
  const perColor = Math.min(10 + n * 3, 30);
  const W = Math.min(1000 + (n - 1) * 140, 2400);
  const H = Math.round(W * 0.6);
  return { colors, perColor, total: colors * perColor, W, H };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function segDist(px, py, o) {
  const dx = o.x2 - o.x1, dy = o.y2 - o.y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - o.x1) * dx + (py - o.y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = o.x1 + dx * t, qy = o.y1 + dy * t;
  return Math.hypot(px - qx, py - qy);
}

export function makeLevel(n, seed) {
  const rng = mulberry32(seed * 7919 + n * 104729);
  const info = levelInfo(n);
  const { W, H, colors, perColor } = info;
  const TL = 200; // tray long side
  const TS = 140; // tray short side

  // Possible tray slots around the board edge. `axis` is the direction a
  // tray may slide along on later levels.
  const slots = [
    { x: 0, y: H / 2 - TL / 2, w: TS, h: TL, axis: 'y' }, // left middle
    { x: W - TS, y: H / 2 - TL / 2, w: TS, h: TL, axis: 'y' }, // right middle
    { x: W * 0.12, y: 0, w: TL, h: TS, axis: 'x' }, // top left
    { x: W * 0.88 - TL, y: H - TS, w: TL, h: TS, axis: 'x' }, // bottom right
    { x: W * 0.88 - TL, y: 0, w: TL, h: TS, axis: 'x' }, // top right
    { x: W * 0.12, y: H - TS, w: TL, h: TS, axis: 'x' }, // bottom left
    { x: W / 2 - TL / 2, y: 0, w: TL, h: TS, axis: 'x' }, // top middle
    { x: W / 2 - TL / 2, y: H - TS, w: TL, h: TS, axis: 'x' }, // bottom middle
  ];
  const order = n <= 2 ? [0, 1] : shuffle(slots.map((_, i) => i), rng);
  const colorOrder = shuffle(PILL_COLORS.map((_, i) => i), rng).slice(0, colors);

  const moving = n >= 6;
  const trays = colorOrder.map((c, i) => {
    const s = slots[order[i]];
    const tray = { c, x: Math.round(s.x), y: Math.round(s.y), w: s.w, h: s.h, count: 0 };
    if (moving) {
      tray.move = {
        axis: s.axis,
        amp: Math.round(s.axis === 'y' ? H * 0.2 : W * 0.07),
        spd: 0.25 + Math.min(n, 15) * 0.025,
        ph: rng() * Math.PI * 2,
      };
    }
    return tray;
  });

  // Pills spawn in one or more clusters; bigger levels spread them out.
  const clusters = [];
  const clusterCount = 1 + Math.floor(n / 4);
  for (let i = 0; i < clusterCount; i++) {
    if (i === 0) clusters.push({ x: W / 2, y: H / 2 });
    else clusters.push({ x: W * (0.28 + rng() * 0.44), y: H * (0.3 + rng() * 0.4) });
  }

  // Obstacles: rounded bars the spatula passes over but pills bump into.
  const obs = [];
  const obsCount = n >= 3 ? Math.min(Math.floor((n - 1) / 2), 8) : 0;
  const mainR = Math.sqrt(info.total / clusterCount) * PILL_R * 1.5 + 40;
  for (let k = 0, tries = 0; k < obsCount && tries < 300; tries++) {
    const len = 120 + rng() * 160;
    const ang = rng() * Math.PI;
    const cx = 240 + rng() * (W - 480);
    const cy = 200 + rng() * (H - 400);
    const o = {
      x1: Math.round(cx - Math.cos(ang) * len / 2), y1: Math.round(cy - Math.sin(ang) * len / 2),
      x2: Math.round(cx + Math.cos(ang) * len / 2), y2: Math.round(cy + Math.sin(ang) * len / 2),
      r: 11,
    };
    if (clusters.some((c) => segDist(c.x, c.y, o) < mainR + 30)) continue;
    if (obs.some((p) => Math.hypot((p.x1 + p.x2) / 2 - cx, (p.y1 + p.y2) / 2 - cy) < 220)) continue;
    obs.push(o);
    k++;
  }

  const pills = [];
  let id = 0;
  const placed = [];
  const colorsList = [];
  for (const t of trays) for (let i = 0; i < perColor; i++) colorsList.push(t.c);
  shuffle(colorsList, rng);
  for (const c of colorsList) {
    const cl = clusters[id % clusterCount];
    let x = cl.x, y = cl.y;
    for (let attempt = 0; attempt < 40; attempt++) {
      const r = Math.sqrt(rng()) * (mainR + attempt * 2);
      const a = rng() * Math.PI * 2;
      x = cl.x + Math.cos(a) * r;
      y = cl.y + Math.sin(a) * r;
      const clash = placed.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < (PILL_R * 2.1) ** 2)
        || obs.some((o) => segDist(x, y, o) < o.r + PILL_R + 2);
      if (!clash) break;
    }
    x = Math.max(TS + 20, Math.min(W - TS - 20, x));
    y = Math.max(TS + 20, Math.min(H - TS - 20, y));
    placed.push({ x, y });
    pills.push([id++, c, Math.round(x), Math.round(y), c % 2, Math.round(rng() * 6283) / 1000]);
  }

  return {
    n,
    seed,
    W,
    H,
    trays,
    obs,
    pills,
    total: pills.length,
    sorted: 0,
    time: 0,
    friction: 0.9 + Math.min(n, 12) * 0.004,
  };
}

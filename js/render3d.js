// 3D view of the table. Physics stays 2D (top-down); sim (x, y) maps to
// three.js (x, z) with the board centred on the origin.
import * as THREE from './vendor/three.module.min.js';
import { PILL_COLORS, PILL_R, mulberry32, makeLevel } from './levels.js';
import { World, SPATULA_HALF, SPATULA_THICK, GRAB_R } from './sim.js';

const MAX_INST = 720;
const MAT_TOP = '#7a69d9';
const MAT_SIDE = '#5b4cb8';
const FRAME = '#fff1e3';
const FRAME_SIDE = '#f2cfe0';
const TOOL_HEIGHT = 7;
const HANDLE = new THREE.Vector3(0, 52, -40);
const WHITE = new THREE.Color('#ffffff');
const UP = new THREE.Vector3(0, 1, 0);

const PILL = PILL_COLORS.map((c) => new THREE.Color(c.hex));
const PILL_LIGHT = PILL_COLORS.map((c) => new THREE.Color(c.hex).lerp(WHITE, 0.62));

// ---------- geometry helpers ----------
function roundRectShape(x, y, w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function roundRectPath(x, y, w, h, r) {
  const p = new THREE.Path();
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.lineTo(x + w, y + h - r);
  p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.lineTo(x, y + r);
  p.quadraticCurveTo(x, y, x + r, y);
  return p;
}

// Extrude a 2D shape (in sim coordinates) into a slab whose top sits at topY.
function slab(shape, depth, topY, bevel = 3) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 10,
  });
  g.rotateX(Math.PI / 2);
  g.translate(0, topY - (bevel > 0 ? bevel : 0), 0);
  return g;
}

function capsuleHalf(radius, halfLen) {
  const pts = [new THREE.Vector2(0.001, 0), new THREE.Vector2(radius, 0)];
  const straight = halfLen - radius;
  pts.push(new THREE.Vector2(radius, straight));
  for (let i = 1; i <= 10; i++) {
    const t = (i / 10) * Math.PI / 2;
    pts.push(new THREE.Vector2(Math.max(0.001, radius * Math.cos(t)), straight + radius * Math.sin(t)));
  }
  const g = new THREE.LatheGeometry(pts, 20);
  g.rotateZ(-Math.PI / 2); // axis +Y -> +X
  return g;
}

function tabletGeometry(r, h) {
  const e = h / 2;
  const pts = [new THREE.Vector2(0.001, -e)];
  pts.push(new THREE.Vector2(r - e, -e));
  for (let i = 1; i < 10; i++) {
    const t = -Math.PI / 2 + (i / 10) * Math.PI;
    pts.push(new THREE.Vector2(r - e + e * Math.cos(t), e * Math.sin(t)));
  }
  pts.push(new THREE.Vector2(r - e, e));
  pts.push(new THREE.Vector2((r - e) * 0.6, e + 0.9));
  pts.push(new THREE.Vector2(0.001, e + 1.2));
  return new THREE.LatheGeometry(pts, 26);
}

function heartGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, -9);
  s.bezierCurveTo(-3, -5, -12, -2, -12, 4);
  s.bezierCurveTo(-12, 9, -7, 12, -3.5, 11);
  s.bezierCurveTo(-1.5, 10.5, 0, 9, 0, 7.5);
  s.bezierCurveTo(0, 9, 1.5, 10.5, 3.5, 11);
  s.bezierCurveTo(7, 12, 12, 9, 12, 4);
  s.bezierCurveTo(12, -2, 3, -5, 0, -9);
  const g = new THREE.ExtrudeGeometry(s, { depth: 4, bevelEnabled: true, bevelThickness: 2.5, bevelSize: 2, bevelSegments: 5, curveSegments: 16 });
  g.center();
  return g;
}

function starGeometry() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 6 : 13;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 4, bevelEnabled: true, bevelThickness: 2.5, bevelSize: 2, bevelSegments: 4 });
  g.center();
  return g;
}

function flowerGroup(mat, center) {
  const g = new THREE.Group();
  const petal = new THREE.SphereGeometry(6, 16, 12);
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(petal, mat);
    const a = (i / 5) * Math.PI * 2;
    m.position.set(Math.cos(a) * 7.5, Math.sin(a) * 7.5, 0);
    m.scale.set(1, 1, 0.6);
    g.add(m);
  }
  const c = new THREE.Mesh(new THREE.SphereGeometry(5.5, 16, 12), center);
  c.position.z = 2;
  g.add(c);
  return g;
}

function cloudGroup(mat) {
  const g = new THREE.Group();
  const sph = new THREE.SphereGeometry(1, 16, 12);
  for (const [x, y, r] of [[-7, -1, 6.5], [0, 3, 8.5], [7.5, -1, 6.5], [0, -3, 6.5]]) {
    const m = new THREE.Mesh(sph, mat);
    m.position.set(x, y, 0);
    m.scale.set(r, r, r * 0.75);
    g.add(m);
  }
  return g;
}

function toyMaterial(color, extra = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.38, clearcoat: 0.9, clearcoatRoughness: 0.25, ...extra });
}

function matTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = MAT_TOP;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(255,255,255,0.07)';
  for (const [x, y] of [[64, 64], [192, 192]]) {
    g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 120, 1 / 120);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function candyTexture(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fff7fb';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = color;
  for (let i = -64; i < 128; i += 32) {
    g.beginPath();
    g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 16 + 64, 64); g.lineTo(i + 64, 64);
    g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      for (const m of [].concat(o.material)) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}

function hash3(a, b, c) {
  return mulberry32(a * 73856093 ^ b * 19349663 ^ c * 83492791);
}

// ---------- renderer ----------
export class Renderer {
  constructor(canvas, overlay) {
    this.canvas = canvas;
    this.ov = overlay;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 5, 30000);
    this.inset = { top: 70, right: 16, bottom: 70, left: 16 };
    this.W = 1000;
    this.H = 600;
    this.fitKey = '';
    this.az = 0;

    this.scene.add(new THREE.HemisphereLight('#fff4fb', '#a99cff', 1.6));
    const sun = new THREE.DirectionalLight('#fff6ec', 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    sun.shadow.radius = 4;
    this.sun = sun;
    this.scene.add(sun, sun.target);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.ShadowMaterial({ opacity: 0.16 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -40;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.levelGroup = new THREE.Group();
    this.scene.add(this.levelGroup);

    const pillMat = toyMaterial('#ffffff', { roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15 });
    const half = capsuleHalf(PILL_R * 0.66, PILL_R * 1.15);
    const mk = (geo) => {
      const m = new THREE.InstancedMesh(geo, pillMat, MAX_INST);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, WHITE);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      this.scene.add(m);
      return m;
    };
    this.capA = mk(half);
    this.capB = mk(half.clone().rotateY(Math.PI));
    this.tab = mk(tabletGeometry(PILL_R, PILL_R * 0.7));

    this.toolObjs = new Map();
    this.toolGeo = {
      blade: new THREE.CapsuleGeometry(SPATULA_THICK, SPATULA_HALF * 2, 6, 18).rotateZ(Math.PI / 2),
      bead: new THREE.SphereGeometry(9.5, 20, 14),
      stick: new THREE.CylinderGeometry(2.8, 2.8, 1, 12),
      prong: new THREE.CylinderGeometry(2.6, 1.6, 1, 10),
      ring: new THREE.TorusGeometry(GRAB_R, 2.4, 10, 56).rotateX(Math.PI / 2),
      heart: heartGeometry(),
      star: starGeometry(),
      ball: new THREE.SphereGeometry(10, 22, 16),
      gem: new THREE.OctahedronGeometry(12, 0),
    };
    this.stickMat = toyMaterial('#ffffff');

    this.fxPool = [];
    this.fxRing = new THREE.RingGeometry(0.75, 1, 40).rotateX(-Math.PI / 2);
    this.fxUsed = new Map();

    this.raycaster = new THREE.Raycaster();
    this.toolPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOOL_HEIGHT);
    this.tmpM = new THREE.Matrix4();
    this.tmpQ = new THREE.Quaternion();
    this.tmpE = new THREE.Euler();
    this.tmpV = new THREE.Vector3();
    this.tmpS = new THREE.Vector3();

    this.trayEls = [];
    this.tagEls = new Map();
    this.transient = new Map();
    this.curWorld = null;
    this.demo = null;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.cw = w;
    this.ch = h;
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.gl.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fitKey = '';
  }

  // ---- camera ----
  fitCamera(W, H, rect, az, shift) {
    const el = 0.98;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    const m = 30;
    const corners = [[-W / 2 - m, -H / 2 - m], [W / 2 + m, -H / 2 - m], [-W / 2 - m, H / 2 + m], [W / 2 + m, H / 2 + m]]
      .flatMap(([x, z]) => [new THREE.Vector3(x, 0, z), new THREE.Vector3(x, -30, z)]);
    let D = Math.max(W, H) * 1.6, tx = 0, tz = 0;
    const cam = this.camera;
    const v = new THREE.Vector3();
    for (let i = 0; i < 16; i++) {
      cam.position.set(tx + dir.x * D, dir.y * D, tz + dir.z * D);
      cam.lookAt(tx, 0, tz);
      cam.updateMatrixWorld();
      let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
      for (const c of corners) {
        v.copy(c).project(cam);
        const sx = (v.x + 1) / 2 * this.cw, sy = (1 - v.y) / 2 * this.ch;
        minx = Math.min(minx, sx); maxx = Math.max(maxx, sx);
        miny = Math.min(miny, sy); maxy = Math.max(maxy, sy);
      }
      const bw = maxx - minx, bh = maxy - miny;
      D *= Math.max(bw / rect.w, bh / rect.h);
      if (shift) {
        tx += ((minx + maxx) / 2 - (rect.x + rect.w / 2)) * (W + 2 * m) / bw;
        tz += ((miny + maxy) / 2 - (rect.y + rect.h / 2)) * (H + 2 * m) / bh * 0.8;
      }
    }
    cam.position.set(tx + dir.x * D, dir.y * D, tz + dir.z * D);
    cam.lookAt(tx, 0, tz);
    cam.updateMatrixWorld();
  }

  toWorld(sx, sy) {
    const ndc = new THREE.Vector2((sx / this.cw) * 2 - 1, -(sy / this.ch) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.toolPlane, hit)) return { x: this.W / 2, y: this.H / 2 };
    return { x: hit.x + this.W / 2, y: hit.z + this.H / 2 };
  }

  project(x, y, z) {
    const v = this.tmpV.set(x - this.W / 2, z, y - this.H / 2).project(this.camera);
    return { x: (v.x + 1) / 2 * this.cw, y: (1 - v.y) / 2 * this.ch, vis: v.z < 1 };
  }

  // ---- level scenery ----
  buildLevel(world, decorative) {
    disposeTree(this.levelGroup);
    this.levelGroup.clear();
    for (const el of this.trayEls) el.remove();
    this.trayEls = [];
    const { W, H } = world;
    this.W = W;
    this.H = H;

    const frame = new THREE.Mesh(
      slab(roundRectShape(-W / 2 - 30, -H / 2 - 30, W + 60, H + 60, 46), 22, -1, 6),
      [toyMaterial(FRAME), toyMaterial(FRAME_SIDE)],
    );
    frame.receiveShadow = true;
    frame.castShadow = true;
    const mat = new THREE.Mesh(
      slab(roundRectShape(-W / 2, -H / 2, W, H, 26), 4, 0, 2),
      [new THREE.MeshStandardMaterial({ map: matTexture(), roughness: 0.85 }), new THREE.MeshStandardMaterial({ color: MAT_SIDE, roughness: 0.8 })],
    );
    mat.receiveShadow = true;
    this.levelGroup.add(frame, mat);

    world.trays.forEach((tr) => {
      const col = PILL_COLORS[tr.c].hex;
      const g = new THREE.Group();
      const floorMat = toyMaterial(new THREE.Color(col).lerp(WHITE, 0.55), { roughness: 0.6, clearcoat: 0.3 });
      const floor = new THREE.Mesh(slab(roundRectShape(0, 0, tr.w, tr.h, 22), 1.5, 1.4, 1), floorMat);
      floor.receiveShadow = true;
      const rimShape = roundRectShape(0, 0, tr.w, tr.h, 22);
      rimShape.holes.push(roundRectPath(8, 8, tr.w - 16, tr.h - 16, 15));
      const rimMat = toyMaterial(col);
      const rim = new THREE.Mesh(slab(rimShape, 3, 5, 1.6), rimMat);
      rim.castShadow = true;
      rim.receiveShadow = true;
      g.add(floor, rim);
      g.userData = { floorMat, rimMat, base: new THREE.Color(col) };
      tr.mesh = g;
      this.levelGroup.add(g);
      if (!decorative) {
        const el = document.createElement('div');
        el.className = 'tray-label';
        const dot = document.createElement('i');
        dot.style.background = col;
        if (tr.shape === 0) dot.classList.add('round');
        const txt = document.createElement('span');
        el.append(dot, txt);
        el._txt = txt;
        this.ov.append(el);
        this.trayEls.push(el);
      }
    });

    const candyColors = ['#ff86c4', '#5fc4ff', '#62f0bd', '#ff9a4d'];
    world.obs.forEach((o, i) => {
      const len = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
      const tex = candyTexture(candyColors[i % candyColors.length]);
      tex.repeat.set(1, Math.max(1, Math.round(len / 34)));
      const geo = new THREE.CapsuleGeometry(o.r, len, 6, 18).rotateZ(Math.PI / 2);
      const m = new THREE.Mesh(geo, toyMaterial('#ffffff', { map: tex }));
      m.position.set((o.x1 + o.x2) / 2 - W / 2, o.r + 1, (o.y1 + o.y2) / 2 - H / 2);
      m.rotation.y = -Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
      m.castShadow = true;
      m.receiveShadow = true;
      this.levelGroup.add(m);
    });

    const S = Math.max(W, H);
    this.sun.position.set(-W * 0.25, S * 1.1, H * 0.55);
    this.sun.target.position.set(0, 0, 0);
    const sc = this.sun.shadow.camera;
    sc.left = -S * 0.75; sc.right = S * 0.75; sc.top = S * 0.75; sc.bottom = -S * 0.75;
    sc.near = 10; sc.far = S * 3;
    sc.updateProjectionMatrix();
    this.fitKey = '';
  }

  // ---- tools ----
  toolObj(pid, color, kindIdx) {
    let o = this.toolObjs.get(pid);
    if (o && o.color === color) return o;
    if (o) this.dropTool(pid);
    const g = this.toolGeo;
    const mat = toyMaterial(color);
    const light = toyMaterial(new THREE.Color(color).lerp(WHITE, 0.6));
    const blade = new THREE.Mesh(g.blade, mat);
    const beadL = new THREE.Mesh(g.bead, light);
    const beadR = new THREE.Mesh(g.bead, light);
    beadL.position.x = -SPATULA_HALF - 4;
    beadR.position.x = SPATULA_HALF + 4;
    const sweep = new THREE.Group();
    sweep.add(blade, beadL, beadR);
    const stick = new THREE.Mesh(g.stick, this.stickMat);
    const ringMat = toyMaterial(color, { transparent: true, opacity: 0.6 });
    const ring = new THREE.Mesh(g.ring, ringMat);
    const prongL = new THREE.Mesh(g.prong, mat);
    const prongR = new THREE.Mesh(g.prong, mat);
    let topper;
    switch (kindIdx % 5) {
      case 0: topper = new THREE.Mesh(g.heart, mat); break;
      case 1: topper = new THREE.Mesh(g.star, mat); break;
      case 2: topper = flowerGroup(mat, toyMaterial('#fff3a6')); break;
      case 3: topper = cloudGroup(light); break;
      default: topper = new THREE.Mesh(g.gem, mat);
    }
    const all = [sweep, stick, ring, prongL, prongR, topper];
    for (const obj of all) obj.traverse((c) => { if (c.isMesh) { c.castShadow = true; } });
    ring.castShadow = false;
    this.scene.add(...all);
    o = { color, sweep, stick, ring, ringMat, prongL, prongR, topper, mats: [mat, light, ringMat], phase: kindIdx * 1.7 };
    this.toolObjs.set(pid, o);
    return o;
  }

  dropTool(pid) {
    const o = this.toolObjs.get(pid);
    if (!o) return;
    for (const obj of [o.sweep, o.stick, o.ring, o.prongL, o.prongR, o.topper]) this.scene.remove(obj);
    for (const m of o.mats) m.dispose();
    this.toolObjs.delete(pid);
  }

  placeStick(mesh, a, b) {
    const d = this.tmpV.subVectors(b, a);
    const len = d.length();
    mesh.position.copy(a).addScaledVector(d, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, d.normalize());
    mesh.scale.set(1, len, 1);
  }

  drawTool(t, now) {
    const o = this.toolObj(t.pid, t.color, t.pid);
    const x = t.x - this.W / 2, z = t.y - this.H / 2;
    const grab = t.kind === 'grab';
    const lift = t.down ? 0 : 16;
    o.sweep.visible = !grab;
    o.ring.visible = o.prongL.visible = o.prongR.visible = grab;
    const base = new THREE.Vector3(x, (grab ? 10 : SPATULA_THICK) + lift, z);
    const top = base.clone().add(HANDLE);
    if (grab) {
      top.y += 22;
      o.ring.position.set(x, 2 + lift * 0.3, z);
      o.ringMat.opacity = t.down ? 0.95 : 0.5;
      const pinch = t.down ? 6 : 17;
      this.placeStick(o.prongL, top.clone().add(new THREE.Vector3(-4, 0, 0)), new THREE.Vector3(x - pinch, 8 + lift, z));
      this.placeStick(o.prongR, top.clone().add(new THREE.Vector3(4, 0, 0)), new THREE.Vector3(x + pinch, 8 + lift, z));
      o.stick.visible = false;
    } else {
      o.sweep.position.copy(base);
      o.sweep.rotation.set(0, -t.a, 0);
      o.stick.visible = true;
      this.placeStick(o.stick, base, top);
    }
    o.topper.position.copy(top);
    o.topper.position.y += 8;
    o.topper.quaternion.copy(this.camera.quaternion);
    o.topper.rotateZ(Math.sin(now / 600 + o.phase) * 0.25);
    const bob = 1 + Math.sin(now / 300 + o.phase) * 0.04;
    o.topper.scale.setScalar(t.me ? 1.15 * bob : bob);
    return top;
  }

  // ---- overlay (HTML labels) ----
  overlayItem(item, cls, build) {
    let el = this.transient.get(item);
    if (!el) {
      el = document.createElement('div');
      el.className = cls;
      build(el);
      this.ov.append(el);
      this.transient.set(item, el);
    }
    el._seen = true;
    return el;
  }

  place(el, p, extra = '') {
    el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)${extra}`;
  }

  // ---- frame ----
  draw(world, view) {
    let decorative = false;
    if (!world) {
      if (!this.demo) {
        this.demo = new World(makeLevel(5, 11));
        for (const tr of this.demo.trays) tr.count = 12 + (tr.c * 5) % 14;
      }
      world = this.demo;
      decorative = true;
    }
    if (world !== this.curWorld) {
      this.curWorld = world;
      this.buildLevel(world, decorative);
    }
    const { W, H } = world;
    const now = view.now;

    if (decorative) {
      this.az = Math.sin(now / 9000) * 0.5;
      this.fitCamera(W, H, { x: 0, y: this.ch * 0.08, w: this.cw, h: this.ch * 0.9 }, this.az, false);
      this.ov.classList.add('demo');
    } else {
      this.ov.classList.remove('demo');
      const r = this.inset;
      const key = `${W}x${H}|${this.cw}x${this.ch}|${r.top},${r.right},${r.bottom},${r.left}`;
      if (key !== this.fitKey) {
        this.fitKey = key;
        this.fitCamera(W, H, { x: r.left, y: r.top, w: this.cw - r.left - r.right, h: this.ch - r.top - r.bottom }, 0, true);
      }
    }

    // trays
    world.trays.forEach((tr, i) => {
      const g = tr.mesh;
      if (!g) return;
      const shake = tr.nope > 0 ? Math.sin(now / 25) * 5 * (tr.nope / 0.4) : 0;
      g.position.set(tr.x - W / 2 + shake, 0, tr.y - H / 2);
      const { floorMat, rimMat, base } = g.userData;
      floorMat.emissive.copy(base).multiplyScalar(tr.flash * 1.2);
      rimMat.color.copy(base);
      if (tr.nope > 0) rimMat.color.lerp(new THREE.Color('#ff3355'), Math.min(1, tr.nope * 2));
      const el = this.trayEls[i];
      if (el) {
        const per = Math.round(world.total / world.trays.length);
        const label = `${tr.count}/${per}`;
        if (el._last !== label) { el._last = label; el._txt.textContent = label; el.classList.toggle('full', tr.count >= per); }
        this.place(el, this.project(tr.x + tr.w / 2, tr.y + tr.h / 2, 46));
      }
    });

    // pills
    let nA = 0, nT = 0;
    const m = this.tmpM, q = this.tmpQ, e = this.tmpE, pos = this.tmpS.set(0, 0, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const put = (shape, c, x, y, z, ry, rx = 0, rz = 0, s = 1) => {
      e.set(rx, ry, rz);
      q.setFromEuler(e);
      pos.set(x, y, z);
      one.setScalar(s);
      m.compose(pos, q, one);
      if (shape === 1) {
        if (nA >= MAX_INST) return;
        this.capA.setMatrixAt(nA, m); this.capA.setColorAt(nA, PILL[c]);
        this.capB.setMatrixAt(nA, m); this.capB.setColorAt(nA, PILL_LIGHT[c]);
        nA++;
      } else {
        if (nT >= MAX_INST) return;
        this.tab.setMatrixAt(nT, m); this.tab.setColorAt(nT, PILL[c]);
        nT++;
      }
    };
    for (const p of world.pills) {
      if (!p.alive) continue;
      const lifted = p.held >= 0 ? 34 : 0;
      put(p.shape, p.c, p.rx - W / 2, (p.shape === 1 ? PILL_R * 0.66 : PILL_R * 0.42) + lifted, p.ry - H / 2, -p.ra);
    }
    world.trays.forEach((tr, ti) => {
      const shown = Math.min(tr.count, 70);
      for (let k = 0; k < shown; k++) {
        const rng = hash3(ti + 1, k + 1, tr.c + 7);
        const px = tr.x + 24 + rng() * (tr.w - 48);
        const py = tr.y + 24 + rng() * (tr.h - 48);
        const layer = Math.floor(k / 26);
        put(tr.shape ?? tr.c % 2, tr.c, px - W / 2, PILL_R * 0.6 + layer * PILL_R * 0.7 + rng() * 2, py - H / 2, rng() * 6.28, (rng() - 0.5) * 0.5, (rng() - 0.5) * 0.5);
      }
    });
    for (const mesh of [this.capA, this.capB]) {
      mesh.count = nA;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.tab.count = nT;
    this.tab.instanceMatrix.needsUpdate = true;
    if (this.tab.instanceColor) this.tab.instanceColor.needsUpdate = true;

    // tools + name tags
    const seenTools = new Set();
    for (const t of decorative ? [] : view.tools) {
      seenTools.add(t.pid);
      const top = this.drawTool(t, now);
      let el = this.tagEls.get(t.pid);
      if (!el) {
        el = document.createElement('div');
        el.className = 'tag';
        const name = document.createElement('span');
        name.className = 'name';
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        el.append(bubble, name);
        el._name = name;
        el._bubble = bubble;
        this.ov.append(el);
        this.tagEls.set(t.pid, el);
      }
      const label = t.me ? `${t.name} (kamu)` : t.name;
      if (el._label !== label) { el._label = label; el._name.textContent = label; }
      el._name.style.background = t.color;
      el._name.hidden = t.me && !view.showOwnTag;
      const bub = t.bubble && now < t.bubble.until ? t.bubble.text : '';
      if (el._bubText !== bub) { el._bubText = bub; el._bubble.textContent = bub; el._bubble.hidden = !bub; }
      this.place(el, this.project(top.x + W / 2, top.z + H / 2, top.y + 52));
    }
    for (const pid of [...this.toolObjs.keys()]) if (!seenTools.has(pid)) this.dropTool(pid);
    for (const [pid, el] of this.tagEls) if (!seenTools.has(pid)) { el.remove(); this.tagEls.delete(pid); }

    // sort effects: expanding ring on the table + floating "+1"
    const liveFx = new Set();
    for (const fx of view.fx) {
      const age = (now - fx.t0) / 900;
      if (age >= 1) continue;
      liveFx.add(fx);
      let ring = this.fxUsed.get(fx);
      if (!ring) {
        ring = this.fxPool.pop() || new THREE.Mesh(this.fxRing, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
        ring.material.color.set(PILL_COLORS[fx.c].hex);
        this.scene.add(ring);
        this.fxUsed.set(fx, ring);
      }
      ring.position.set(fx.x - W / 2, 9, fx.y - H / 2);
      ring.scale.setScalar(8 + age * 40);
      ring.material.opacity = 1 - age;
      if (fx.color) {
        const el = this.overlayItem(fx, 'plus', (d) => { d.textContent = '+1'; d.style.color = fx.color; });
        el.style.opacity = String(1 - age);
        this.place(el, this.project(fx.x, fx.y, 30 + age * 60));
      }
    }
    for (const [fx, ring] of this.fxUsed) {
      if (!liveFx.has(fx)) { this.scene.remove(ring); this.fxPool.push(ring); this.fxUsed.delete(fx); }
    }

    for (const em of view.emotes) {
      const age = (now - em.t0) / 1600;
      if (age >= 1) continue;
      const el = this.overlayItem(em, 'emote', (d) => { d.textContent = em.e; });
      el.style.opacity = String(age < 0.7 ? 1 : 1 - (age - 0.7) / 0.3);
      this.place(el, this.project(em.x + Math.sin(age * 9 + em.x) * 10, em.y, 90 + age * 120), ` scale(${0.6 + Math.min(age * 4, 0.6)})`);
    }

    for (const [item, el] of this.transient) {
      if (!el._seen) { el.remove(); this.transient.delete(item); } else el._seen = false;
    }

    this.gl.render(this.scene, this.camera);
  }
}

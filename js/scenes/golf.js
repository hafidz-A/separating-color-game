// 3D view for "Golf Mini": checkered grass tiles floating on a sky
// background, white rails, a fluttering flag, sand, water, bumpers and
// spinning windmill bars.
import * as THREE from '../vendor/three.module.min.js';
import { toyMaterial, roundRectShape, slab } from '../render3d.js';
import { TILE, BALL_R, HOLE_R } from '../modes/golf.js';


function grassTexture(light) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = light ? '#8fe08a' : '#7fd47f';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(255,255,255,0.07)';
  for (let x = 0; x < 128; x += 32) g.fillRect(x, 0, 16, 128);
  g.fillStyle = 'rgba(40,120,50,0.18)';
  for (let k = 0; k < 90; k++) g.fillRect((k * 53) % 128, (k * 29) % 128, 2, 4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 100, 1 / 100);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class GolfScene {
  build(world, core) {
    const { W, H } = world;
    const g = core.levelGroup;
    const ox = -W / 2, oz = -H / 2;
    this.ox = ox; this.oz = oz;

    // Tiles: grass top on a soil block, alternating shades.
    const grassA = new THREE.MeshStandardMaterial({ map: grassTexture(true), roughness: 0.9 });
    const grassB = new THREE.MeshStandardMaterial({ map: grassTexture(false), roughness: 0.9 });
    const soil = new THREE.MeshStandardMaterial({ color: '#b98a5a', roughness: 0.95 });
    world.cells.forEach(([cx, cy], i) => {
      const x0 = ox + 40 + cx * TILE, z0 = oz + 40 + cy * TILE;
      const mesh = new THREE.Mesh(slab(roundRectShape(x0, z0, TILE, TILE, 6), 30, 0, 2), [(cx + cy) % 2 ? grassA : grassB, soil]);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      g.add(mesh);
      if (i === 0) {
        const tee = new THREE.Mesh(slab(roundRectShape(world.tee[0] - 34 + ox, world.tee[1] - 34 + oz, 68, 68, 10), 1, 0.9, 0), toyMaterial('#5fbf6a', { roughness: 0.8, clearcoat: 0 }));
        tee.receiveShadow = true;
        g.add(tee);
      }
    });

    // Rails
    const railMat = toyMaterial('#ffffff');
    const railTop = toyMaterial('#ff8fb8');
    for (const [ax, ay, bx, by] of world.walls) {
      const len = Math.hypot(bx - ax, by - ay) + 8;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 12, 8), railMat);
      rail.position.set((ax + bx) / 2 + ox, 6, (ay + by) / 2 + oz);
      rail.rotation.y = -Math.atan2(by - ay, bx - ax);
      rail.castShadow = true;
      rail.receiveShadow = true;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(len, 3, 9), railTop);
      cap.position.y = 7;
      rail.add(cap);
      g.add(rail);
    }

    // Hazards
    for (const [x, y, r] of world.sand) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.2, 36), new THREE.MeshStandardMaterial({ color: '#f3dc9b', roughness: 1 }));
      m.position.set(x + ox, 0.6, y + oz);
      m.receiveShadow = true;
      g.add(m);
    }
    this.waterMats = [];
    for (const [x, y, r] of world.water) {
      const mat = new THREE.MeshStandardMaterial({ color: '#4fc3ff', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.88 });
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.4, 36), mat);
      m.position.set(x + ox, 0.7, y + oz);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 2.2, 8, 40).rotateX(Math.PI / 2), toyMaterial('#d7f3ff'));
      rim.position.set(x + ox, 1.5, y + oz);
      g.add(m, rim);
      this.waterMats.push(mat);
    }
    const bumperColors = ['#ff86c4', '#ffb15c', '#b79bff', '#5fc4ff'];
    world.bumpers.forEach(([x, y, r], i) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 18, 28), toyMaterial(bumperColors[i % bumperColors.length]));
      m.position.set(x + ox, 9, y + oz);
      m.castShadow = true;
      const top = new THREE.Mesh(new THREE.TorusGeometry(r * 0.7, 2.2, 8, 28).rotateX(Math.PI / 2), toyMaterial('#ffffff'));
      top.position.y = 9.5;
      m.add(top);
      g.add(m);
    });
    this.bars = world.bars.map(([x, y, len]) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, 26, 16), toyMaterial('#ffe066'));
      post.position.set(x + ox, 13, y + oz);
      post.castShadow = true;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 12, 10), toyMaterial('#ff6f91'));
      bar.position.set(x + ox, 9, y + oz);
      bar.castShadow = true;
      g.add(post, bar);
      return bar;
    });

    // Hole + flag
    const [hx, hy] = world.hole;
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(HOLE_R, HOLE_R, 1, 32), new THREE.MeshBasicMaterial({ color: '#1f2a1f' }));
    cup.position.set(hx + ox, 0.55, hy + oz);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(HOLE_R + 1, 1.6, 8, 32).rotateX(Math.PI / 2), toyMaterial('#ffffff'));
    lip.position.set(hx + ox, 0.9, hy + oz);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 78, 10), toyMaterial('#ffffff'));
    pole.position.set(hx + ox, 39, hy + oz);
    pole.castShadow = true;
    const flagShape = new THREE.Shape();
    flagShape.moveTo(0, 0); flagShape.lineTo(34, -10); flagShape.lineTo(0, -22); flagShape.closePath();
    const flag = new THREE.Mesh(new THREE.ShapeGeometry(flagShape), new THREE.MeshStandardMaterial({ color: '#ff4d6d', side: THREE.DoubleSide }));
    flag.position.set(hx + ox, 78, hy + oz);
    flag.castShadow = true;
    g.add(cup, lip, pole, flag);
    this.flag = flag;

    this.ballGeo = new THREE.SphereGeometry(BALL_R, 22, 16);
    this.ringGeo = new THREE.TorusGeometry(17, 2.4, 8, 36).rotateX(Math.PI / 2);
    this.camP = null;
    this.camL = null;
    this.balls = new Map();
    this.arrowShaft = new THREE.BoxGeometry(1, 3, 7);
    this.arrowHead = new THREE.ConeGeometry(11, 22, 14).rotateZ(-Math.PI / 2);
  }

  ball(pid, color, core) {
    let o = this.balls.get(pid);
    if (o && o.color === color) return o;
    const mat = toyMaterial(color, { clearcoat: 1, roughness: 0.25 });
    const mesh = new THREE.Mesh(this.ballGeo, mat);
    mesh.castShadow = true;
    mesh.scale.setScalar(1.45); // a little bigger than its hit circle so it reads well
    const arrow = new THREE.Group();
    const shaft = new THREE.Mesh(this.arrowShaft, toyMaterial(color, { transparent: true, opacity: 0.85 }));
    const head = new THREE.Mesh(this.arrowHead, shaft.material);
    arrow.add(shaft, head);
    // A ring in the player's colour under every ball, so balls are easy to tell apart.
    const ring = new THREE.Mesh(this.ringGeo, toyMaterial(color, { transparent: true, opacity: 0.85 }));
    core.levelGroup.add(mesh, arrow, ring);
    o = { color, mesh, arrow, shaft, head, ring };
    this.balls.set(pid, o);
    return o;
  }

  update(world, view, core, now) {
    const { ox, oz } = this;
    // Windmill bars spin with the shared clock.
    world.bars.forEach((b, i) => {
      const a = world.barEnds(b)[4];
      this.bars[i].rotation.y = -a;
    });
    this.flag.rotation.y = Math.sin(now / 500) * 0.35;
    for (const m of this.waterMats) m.opacity = 0.82 + Math.sin(now / 400) * 0.06;

    const colors = new Map(view.tools.map((t) => [t.pid, t]));
    const anchors = new Map();
    const seen = new Set();
    for (const b of world.balls.values()) {
      const t = colors.get(b.pid);
      if (!t) continue;
      const o = this.ball(b.pid, t.color, core);
      seen.add(b.pid);
      o.mesh.visible = !b.holed;
      o.mesh.position.set(b.rx + ox, BALL_R * 1.45, b.ry + oz);
      o.ring.visible = !b.holed;
      o.ring.position.set(b.rx + ox, 1.2, b.ry + oz);
      const pulse = t.me ? 1.15 + Math.sin(now / 250) * 0.12 : 1;
      o.ring.scale.set(pulse, 1, pulse);
      const len = Math.hypot(b.ax, b.ay);
      o.arrow.visible = !b.holed && !!b.aim && len > 10;
      if (o.arrow.visible) {
        const power = Math.min(len, 170) / 170;
        // Long, low aim line so it reads from behind the ball too.
        const L = 40 + power * 260;
        const start = BALL_R * 2;
        o.arrow.position.set(b.rx + ox, 3, b.ry + oz);
        o.arrow.rotation.y = -Math.atan2(b.ay, b.ax);
        o.shaft.scale.x = L;
        o.shaft.position.x = start + L / 2;
        o.head.position.x = start + L + 9;
        const hue = new THREE.Color(t.color).lerp(new THREE.Color('#ff3344'), power * 0.7);
        o.shaft.material.color.copy(hue);
      }
      if (!b.holed) anchors.set(b.pid, new THREE.Vector3(b.rx + ox, BALL_R + 8, b.ry + oz));
    }
    for (const [pid, o] of this.balls) if (!seen.has(pid)) { o.mesh.visible = false; o.arrow.visible = false; o.ring.visible = false; }
    return anchors;
  }

  // Third-person camera behind the player's own ball. Returns false to fall
  // back to the whole-course view (overview toggle, or ball already in).
  controlsCamera(world, view, core, now) {
    const g = view.golf || {};
    const me = world.balls.get(view.myId);
    const dt = Math.min(0.1, (now - (this.lastT || now)) / 1000);
    this.lastT = now;
    if (g.overview || !me || me.holed) { this.camP = null; return false; }
    core.setFov(55);
    const yaw = g.yaw || 0;
    const dx = Math.cos(yaw), dz = Math.sin(yaw);
    const bx = me.rx - world.W / 2, bz = me.ry - world.H / 2;
    const wantP = new THREE.Vector3(bx - dx * 230, 150, bz - dz * 230);
    const wantL = new THREE.Vector3(bx + dx * 120, 0, bz + dz * 120);
    if (!this.camP) { this.camP = wantP.clone(); this.camL = wantL.clone(); }
    const k = 1 - Math.exp(-dt * 7);
    this.camP.lerp(wantP, k);
    this.camL.lerp(wantL, k);
    core.camera.position.copy(this.camP);
    core.camera.lookAt(this.camL);
    core.camera.updateMatrixWorld();
    return true;
  }
}


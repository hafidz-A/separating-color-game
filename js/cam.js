// Optional webcams (video only, never audio). Every player who turns their
// camera on calls every other player directly over WebRTC; viewers answer
// without sending anything back, so nobody's camera starts unless they press
// the camera button themselves.

const VIDEO = {
  audio: false,
  video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15, max: 20 }, facingMode: 'user' },
};

export class CamHub {
  constructor({ peer, players, myId, onState, onLayout, toast }) {
    this.getPeer = peer;
    this.players = players;
    this.myId = myId;
    this.onState = onState;
    this.onLayout = onLayout;
    this.toast = toast;
    this.stream = null;
    this.out = new Map(); // remote peer id -> outgoing call
    this.inc = new Map(); // remote peer id -> { call, stream }
    this.tiles = new Map(); // key -> element
    this.box = document.getElementById('cams');
    this.setupResize();
  }

  // ---- resizable webcam bubbles: pinch, scroll / trackpad pinch, or − / + ----
  limits() {
    const narrow = window.innerWidth <= 900;
    return narrow
      ? { min: 44, max: Math.max(60, Math.min(150, window.innerWidth * 0.42)), def: 76 }
      : { min: 64, max: Math.max(90, Math.min(240, window.innerHeight * 0.34)), def: 128 };
  }

  setupResize() {
    const key = () => 'pilahpil.camSize.' + (window.innerWidth <= 900 ? 'phone' : 'desk');
    const read = () => { try { return parseFloat(localStorage.getItem(key())); } catch { return NaN; } };
    this.setSize = (v, save = true) => {
      const { min, max, def } = this.limits();
      this.size = Math.round(Math.max(min, Math.min(max, Number.isFinite(v) ? v : def)));
      this.box.style.setProperty('--cam', this.size + 'px');
      this.minus.disabled = this.size <= min;
      this.plus.disabled = this.size >= max;
      if (save) { try { localStorage.setItem(key(), String(this.size)); } catch { /* storage unavailable */ } }
      this.onLayout();
    };

    const zoom = document.createElement('div');
    zoom.className = 'cam-zoom';
    this.minus = document.createElement('button');
    this.minus.textContent = '−';
    this.minus.title = 'Perkecil kamera';
    this.plus = document.createElement('button');
    this.plus.textContent = '+';
    this.plus.title = 'Perbesar kamera';
    zoom.append(this.minus, this.plus);
    this.box.append(zoom);
    this.minus.addEventListener('click', () => this.setSize(this.size / 1.2));
    this.plus.addEventListener('click', () => this.setSize(this.size * 1.2));

    // Mouse wheel or trackpad pinch (which arrives as ctrl+wheel).
    this.box.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = e.ctrlKey ? 0.01 : 0.0025;
      this.setSize(this.size * Math.exp(-e.deltaY * k));
    }, { passive: false });

    // Two-finger pinch on the webcams.
    const pts = new Map();
    let start = null;
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    this.box.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) start = { d: dist(), size: this.size };
    });
    this.box.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && start && start.d > 10) this.setSize(start.size * (dist() / start.d), false);
    });
    const end = (e) => {
      if (!pts.delete(e.pointerId)) return;
      if (start && pts.size < 2) { start = null; this.setSize(this.size); }
    };
    this.box.addEventListener('pointerup', end);
    this.box.addEventListener('pointercancel', end);
    this.box.addEventListener('pointerleave', end);

    let narrow = window.innerWidth <= 900;
    window.addEventListener('resize', () => {
      const now = window.innerWidth <= 900;
      if (now !== narrow) { narrow = now; this.setSize(read(), false); } else this.setSize(this.size, false);
    });
    this.setSize(read(), false);
  }

  get on() {
    return !!this.stream;
  }

  async start() {
    if (this.stream) return true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.toast('Kamera cuma bisa dipakai lewat link https (mis. GitHub Pages).');
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(VIDEO);
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      this.toast(denied ? 'Izin kamera ditolak. Bisa diizinkan lagi dari pengaturan browser.' : 'Kamera tidak bisa dibuka.');
      return false;
    }
    for (const tr of this.stream.getVideoTracks()) tr.addEventListener('ended', () => this.stop());
    this.onState(true);
    this.sync();
    return true;
  }

  stop() {
    if (!this.stream) return;
    for (const tr of this.stream.getTracks()) tr.stop();
    this.stream = null;
    for (const c of this.out.values()) c.close();
    this.out.clear();
    this.onState(false);
    this.render();
  }

  reset() {
    this.stop();
    for (const { call } of this.inc.values()) call.close();
    this.inc.clear();
    this.render();
  }

  playerByPeer(peerId) {
    for (const p of this.players().values()) if (p.peer === peerId && p.id !== this.myId()) return p;
    return null;
  }

  // Call any player we are not streaming to yet; forget players who left
  // or switched their camera off.
  sync() {
    const peer = this.getPeer();
    const known = new Set();
    for (const p of this.players().values()) if (p.id !== this.myId() && p.peer) known.add(p.peer);
    if (this.stream && peer && !peer.destroyed) {
      for (const id of known) {
        if (this.out.has(id)) continue;
        const call = peer.call(id, this.stream, { metadata: { cam: 1 } });
        if (!call) continue;
        this.out.set(id, call);
        const drop = () => { if (this.out.get(id) === call) this.out.delete(id); };
        call.on('close', drop);
        call.on('error', drop);
      }
    }
    for (const [id, c] of this.out) if (!known.has(id)) { c.close(); this.out.delete(id); }
    for (const [id, v] of this.inc) {
      const p = this.playerByPeer(id);
      // A fresh call can arrive just before the "camera on" flag does.
      if (!p || (!p.cam && performance.now() - v.t0 > 4000)) { v.call.close(); this.inc.delete(id); }
    }
    this.render();
  }

  handleCall(call, tries = 0) {
    // Only accept video from people who are in this room.
    if (!this.playerByPeer(call.peer)) {
      if (tries < 6) setTimeout(() => this.handleCall(call, tries + 1), 500);
      else call.close();
      return;
    }
    const old = this.inc.get(call.peer);
    if (old && old.call !== call) old.call.close();
    const entry = { call, stream: null, t0: performance.now() };
    this.inc.set(call.peer, entry);
    call.on('stream', (s) => { entry.stream = s; this.render(); });
    const drop = () => { if (this.inc.get(call.peer) === entry) { this.inc.delete(call.peer); this.render(); } };
    call.on('close', drop);
    call.on('error', drop);
    call.answer();
  }

  // Show a chat message next to the sender's webcam for a few seconds.
  say(pid, text) {
    let key = null;
    if (pid === this.myId()) key = 'me';
    else {
      const p = this.players().get(pid);
      if (p && p.peer) key = p.peer;
    }
    const el = key && this.tiles.get(key);
    if (!el) return;
    el._say.textContent = text;
    el._say.hidden = false;
    clearTimeout(el._sayT);
    el._sayT = setTimeout(() => { el._say.hidden = true; }, 4500);
  }

  render() {
    const want = new Map();
    const me = this.players().get(this.myId());
    if (this.stream && me) want.set('me', { stream: this.stream, p: me, me: true });
    for (const [id, v] of this.inc) {
      const p = this.playerByPeer(id);
      if (p && v.stream) want.set(id, { stream: v.stream, p, me: false });
    }
    for (const [key, el] of this.tiles) {
      if (!want.has(key)) { el.remove(); this.tiles.delete(key); }
    }
    for (const [key, w] of want) {
      let el = this.tiles.get(key);
      if (!el) {
        el = document.createElement('div');
        el.className = 'cam' + (w.me ? ' me' : '');
        const v = document.createElement('video');
        v.autoplay = true;
        v.muted = true;
        v.playsInline = true;
        v.setAttribute('playsinline', '');
        const name = document.createElement('span');
        const say = document.createElement('div');
        say.className = 'say';
        say.hidden = true;
        el.append(v, name, say);
        el._v = v;
        el._n = name;
        el._say = say;
        this.box.append(el);
        this.tiles.set(key, el);
      }
      if (el._v.srcObject !== w.stream) {
        el._v.srcObject = w.stream;
        el._v.play().catch(() => {});
      }
      el.style.setProperty('--c', w.p.color);
      el._n.textContent = w.me ? 'Kamu' : w.p.name;
    }
    const wasHidden = this.box.hidden;
    this.box.hidden = this.tiles.size === 0;
    if (wasHidden && !this.box.hidden && !this.hinted) {
      this.hinted = true;
      const touch = matchMedia('(pointer: coarse)').matches;
      this.toast(touch ? 'Cubit (pinch) kamera untuk atur besar-kecilnya 🤏' : 'Scroll di atas kamera (atau tombol − / +) untuk atur ukurannya');
    }
    this.onLayout();
  }
}

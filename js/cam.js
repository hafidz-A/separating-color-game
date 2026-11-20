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
        el.append(v, name);
        el._v = v;
        el._n = name;
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
    this.box.hidden = this.tiles.size === 0;
    this.onLayout();
  }
}

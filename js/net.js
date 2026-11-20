// Thin wrapper around PeerJS. The host's browser runs the game; guests send
// their hand position and receive snapshots. No game server needed: PeerJS's
// free signalling server only introduces the browsers to each other.

const PREFIX = 'pilahpil-v1-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ';

export function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export function cleanCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
}

// STUN finds a direct route between two browsers; TURN relays the game when
// no direct route exists (common on mobile data). Extra TURN servers can be
// added in js/config.js.
let iceList = null;

function iceServers() {
  if (iceList) return iceList;
  const list = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  const extra = window.PILAHPIL_TURN;
  if (Array.isArray(extra)) for (const s of extra) if (s && s.urls) list.push(s);
  // The free PeerJS relay is a last resort only when no own relay is set.
  if (list.length <= 2) {
    list.push({ urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' });
  }
  return list;
}

// Fetch relay (TURN) credentials once, e.g. from Metered's credentials API
// (window.PILAHPIL_TURN_URL in js/config.js). Falls back to the built-in list.
export async function loadIce() {
  if (iceList) return iceList;
  const url = window.PILAHPIL_TURN_URL;
  let fetched = [];
  if (typeof url === 'string' && /^https:\/\//.test(url)) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      const data = await res.json();
      if (Array.isArray(data)) fetched = data.filter((x) => x && x.urls);
    } catch { /* relay list unavailable; use the defaults */ }
  }
  const base = iceServers();
  iceList = fetched.length ? [...base.filter((x) => !String(x.urls).includes('peerjs.com')), ...fetched] : base;
  return iceList;
}

function peerOptions() {
  // ?peerhost=…&peerport=…&peerpath=…&peersecure=0 points at a self-hosted
  // PeerServer; by default the public PeerJS cloud is used.
  const q = new URLSearchParams(location.search);
  const o = { debug: 1, config: { iceServers: iceServers() } };
  if (q.get('peerhost')) {
    o.host = q.get('peerhost');
    o.port = +(q.get('peerport') || 443);
    o.path = q.get('peerpath') || '/';
    o.secure = q.get('peersecure') !== '0';
  }
  return o;
}

function errorText(err) {
  switch (err && err.type) {
    case 'peer-unavailable': return 'Room tidak ditemukan. Cek lagi kodenya ya.';
    case 'unavailable-id': return 'Kode room sudah dipakai.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed': return 'Gagal tersambung ke server room. Tekan "Cek koneksi" di bawah.';
    case 'browser-incompatible': return 'Browser ini belum mendukung WebRTC.';
    default: return 'Koneksi bermasalah: ' + ((err && (err.type || err.message)) || 'unknown');
  }
}

export class HostNet {
  constructor(handlers) {
    this.h = handlers;
    this.conns = new Set();
    this.code = null;
    this.peer = null;
  }

  async start(code, attempt = 0) {
    await loadIce();
    return new Promise((resolve, reject) => {
      const peer = new window.Peer(PREFIX + code, peerOptions());
      let opened = false;
      const giveUp = setTimeout(() => {
        if (opened) return;
        peer.destroy();
        clearInterval(this.retryTimer);
        reject(new Error('Server room tidak bisa dihubungi dari jaringan ini. Tekan "Cek koneksi" di bawah.'));
      }, 15000);
      peer.on('open', () => {
        clearTimeout(giveUp);
        opened = true;
        this.peer = peer;
        this.code = code;
        resolve(code);
      });
      peer.on('connection', (conn) => {
        conn.on('open', () => { this.conns.add(conn); this.h.open(conn); });
        conn.on('data', (d) => this.h.data(conn, d));
        conn.on('close', () => { if (this.conns.delete(conn)) this.h.close(conn); });
        conn.on('error', () => { if (this.conns.delete(conn)) this.h.close(conn); });
      });
      peer.on('call', (call) => { if (this.h.call) this.h.call(call); else call.close(); });
      // Lost the signalling server (often because a phone put this tab to
      // sleep): players already in keep playing, and we reconnect so new
      // friends can still join.
      const reconnect = () => {
        if (peer.destroyed || !peer.disconnected) return;
        try { peer.reconnect(); } catch { /* retried below */ }
      };
      let away = false;
      peer.on('disconnected', () => {
        if (!away && this.h.status) this.h.status('away');
        away = true;
        setTimeout(reconnect, 1000);
      });
      peer.on('open', () => {
        if (away && this.h.status) this.h.status('back');
        away = false;
      });
      this.onVisible = () => { if (document.visibilityState === 'visible') reconnect(); };
      document.addEventListener('visibilitychange', this.onVisible);
      this.retryTimer = setInterval(reconnect, 5000);
      peer.on('error', (err) => {
        if (!opened) {
          clearTimeout(giveUp);
          clearInterval(this.retryTimer);
          peer.destroy();
          if (err.type === 'unavailable-id' && attempt < 4) {
            this.start(makeCode(), attempt + 1).then(resolve, reject);
          } else reject(new Error(errorText(err)));
        } else if (this.h.warn && err.type !== 'peer-unavailable') this.h.warn(errorText(err));
      });
    });
  }

  send(conn, msg) {
    if (conn.open) conn.send(msg);
  }

  broadcast(msg, except) {
    for (const c of this.conns) if (c !== except && c.open) c.send(msg);
  }

  close() {
    if (this.peer) this.peer.destroy();
    this.conns.clear();
    clearInterval(this.retryTimer);
    if (this.onVisible) document.removeEventListener('visibilitychange', this.onVisible);
  }
}

export class ClientNet {
  constructor(handlers) {
    this.h = handlers;
    this.peer = null;
    this.conn = null;
  }

  // Keeps knocking for up to ~45 s, so a host who briefly switched apps
  // (e.g. to send the link on WhatsApp) can come back and let us in.
  async connect(code, onStatus = () => {}) {
    await loadIce();
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 45000;
      let settled = false;
      let attempt = null;
      let tries = 0;
      let notFound = false;
      let iceFailed = false;
      const peer = new window.Peer(peerOptions());
      this.peer = peer;
      const fail = (msg) => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        peer.destroy();
        reject(new Error(msg));
      };
      const guard = setTimeout(() => fail('Server room tidak bisa dihubungi. Cek internet lalu coba lagi.'), 60000);
      const giveUp = () => {
        if (iceFailed) fail('Jaringan memblokir sambungan ke host. Coba salah satu pindah jaringan (Wi-Fi ↔ data seluler).');
        else if (notFound) fail('Room tidak ditemukan. Cek kodenya, dan pastikan host masih membuka halaman game.');
        else fail('Host belum menjawab. Minta host membuka halaman game (jangan ditinggal ke aplikasi lain), lalu coba lagi.');
      };
      const next = (delay) => {
        if (settled) return;
        if (Date.now() + delay > deadline) giveUp();
        else setTimeout(knock, delay);
      };
      const knock = () => {
        if (settled) return;
        tries++;
        onStatus(tries === 1 ? 'Menyambung ke room…' : `Menunggu host menjawab… (${tries})`);
        const conn = peer.connect(PREFIX + code, { reliable: true });
        const me = { conn, done: false };
        attempt = me;
        const retry = (delay) => {
          if (me.done || settled) return;
          me.done = true;
          clearTimeout(t);
          try { conn.close(); } catch { /* already closed */ }
          next(delay);
        };
        me.retry = retry;
        const t = setTimeout(() => retry(500), 9000);
        conn.on('open', () => {
          if (me.done || settled) return;
          me.done = true;
          settled = true;
          clearTimeout(t);
          clearTimeout(guard);
          this.conn = conn;
          conn.on('data', (d) => this.h.data(d));
          conn.on('close', () => this.h.close());
          conn.on('error', () => this.h.close());
          resolve();
        });
        conn.on('error', () => retry(1500));
        // Notice early when the network refuses every route.
        setTimeout(() => {
          const pc = conn.peerConnection;
          if (!pc) return;
          pc.addEventListener('iceconnectionstatechange', () => {
            if (pc.iceConnectionState === 'failed') { iceFailed = true; retry(1500); }
          });
        }, 0);
      };
      peer.on('open', knock);
      peer.on('call', (call) => { if (this.h.call) this.h.call(call); else call.close(); });
      peer.on('error', (err) => {
        if (settled) {
          if (this.h.warn && err.type !== 'peer-unavailable') this.h.warn(errorText(err));
          return;
        }
        if (err.type === 'peer-unavailable') {
          // The host is not registered right now (wrong code, or their tab is asleep).
          notFound = true;
          onStatus('Room belum ketemu, menunggu host…');
          if (attempt && attempt.retry) attempt.retry(2500);
          return;
        }
        fail(errorText(err));
      });
    });
  }

  send(msg) {
    if (this.conn && this.conn.open) this.conn.send(msg);
  }

  close() {
    if (this.peer) this.peer.destroy();
  }
}

// Step-by-step connection check, shown in the lobby, so a player can see
// which part fails on their own phone or network.
export async function diagnose(onStep) {
  const out = { webrtc: false, server: false, direct: false, relay: false };
  await loadIce();
  out.webrtc = typeof window.RTCPeerConnection === 'function' && !!window.Peer;
  onStep({ ...out, running: 'server' });
  if (out.webrtc) {
    out.server = await new Promise((resolve) => {
      let p;
      try { p = new window.Peer(peerOptions()); } catch { resolve(false); return; }
      const t = setTimeout(() => { p.destroy(); resolve(false); }, 10000);
      p.on('open', () => { clearTimeout(t); p.destroy(); resolve(true); });
      p.on('error', () => { clearTimeout(t); p.destroy(); resolve(false); });
    });
  }
  onStep({ ...out, running: 'ice' });
  if (out.webrtc) {
    try {
      const pc = new RTCPeerConnection({ iceServers: iceServers() });
      pc.createDataChannel('check');
      const types = new Set();
      pc.onicecandidate = (e) => {
        const m = e.candidate && / typ (\w+)/.exec(e.candidate.candidate);
        if (m) types.add(m[1]);
      };
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 8000);
        pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); } };
      });
      pc.close();
      out.direct = types.has('srflx');
      out.relay = types.has('relay');
    } catch { /* leave as failed */ }
  }
  onStep({ ...out, running: null });
  return out;
}

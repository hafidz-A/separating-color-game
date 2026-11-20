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

function peerOptions() {
  // ?peerhost=…&peerport=…&peerpath=…&peersecure=0 points at a self-hosted
  // PeerServer; by default the public PeerJS cloud is used.
  const q = new URLSearchParams(location.search);
  const o = { debug: 1 };
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
    case 'socket-closed': return 'Gagal tersambung ke server room. Coba lagi sebentar.';
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

  start(code, attempt = 0) {
    return new Promise((resolve, reject) => {
      const peer = new window.Peer(PREFIX + code, peerOptions());
      let opened = false;
      peer.on('open', () => {
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
      peer.on('disconnected', () => {
        // Lost the signalling server: existing players keep playing, but
        // reconnect so new friends can still join.
        if (!peer.destroyed) setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, 1500);
      });
      peer.on('error', (err) => {
        if (!opened) {
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
  }
}

export class ClientNet {
  constructor(handlers) {
    this.h = handlers;
    this.peer = null;
    this.conn = null;
  }

  connect(code) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (msg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.peer) this.peer.destroy();
        reject(new Error(msg));
      };
      const timer = setTimeout(() => fail('Tidak ada jawaban dari room. Pastikan host masih online.'), 15000);
      const peer = new window.Peer(peerOptions());
      this.peer = peer;
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true });
        this.conn = conn;
        conn.on('open', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        });
        conn.on('data', (d) => this.h.data(d));
        conn.on('close', () => { if (settled) this.h.close(); });
        conn.on('error', () => { if (settled) this.h.close(); });
      });
      peer.on('call', (call) => { if (this.h.call) this.h.call(call); else call.close(); });
      peer.on('error', (err) => {
        if (!settled) fail(errorText(err));
        else if (this.h.warn && err.type !== 'peer-unavailable') this.h.warn(errorText(err));
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

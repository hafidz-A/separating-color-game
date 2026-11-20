import { makeLevel, PILL_COLORS } from './levels.js';
import { World } from './sim.js';
import { Renderer } from './render.js';
import { HostNet, ClientNet, makeCode, cleanCode } from './net.js';

const $ = (id) => document.getElementById(id);
const PLAYER_COLORS = ['#ff6fa3', '#4fd2ff', '#ffcb47', '#86ee8a', '#c08bff', '#ff9a5c', '#5af0d2', '#ff6be0', '#a7b6ff', '#f2f2f2'];
const EMOTES = ['💗', '🤣', '👏', '🔥', '😴', '🫶'];
const MAX_PLAYERS = 10;
const SNAP_MS = 50;
const INPUT_MS = 33;

const store = {
  get(k, d) { try { const v = localStorage.getItem('pilahpil.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pilahpil.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

const S = {
  mode: null, // 'solo' | 'host' | 'client'
  world: null,
  myId: 0,
  players: new Map(),
  input: { x: 0, y: 0, a: -0.6, k: 'sweep', d: false },
  remoteTools: new Map(), // client-side mirror of other players' hands
  bubbles: new Map(),
  fx: [],
  emotes: [],
  phase: 'play',
  net: null,
  code: null,
  pendingEvents: [],
  lastSnap: 0,
  lastInputSent: 0,
  lastInputKey: '',
  nextId: 1,
  leaving: false,
  clearTimer: null,
  muted: store.get('muted', false),
  hasPointer: false,
};

const renderer = new Renderer($('cv'));

// ---------------- sound ----------------
let audio = null;
function ac() {
  if (S.muted) return null;
  if (!audio) {
    try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  }
  if (audio.state === 'suspended') audio.resume();
  return audio;
}
function tone(freq, dur, type = 'sine', vol = 0.08, delay = 0) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(freq * 1.5, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}
let lastPop = 0;
const sfx = {
  pop(c) {
    const now = performance.now();
    if (now - lastPop < 40) return;
    lastPop = now;
    tone(520 + c * 70 + Math.random() * 40, 0.11);
  },
  nope() { tone(180, 0.12, 'triangle', 0.06); },
  clear() { [0, 4, 7, 12].forEach((s, i) => tone(523 * Math.pow(2, s / 12), 0.22, 'sine', 0.08, i * 0.1)); },
};

// ---------------- helpers ----------------
function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), ms);
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

function cleanName(s) {
  return String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 16) || 'Teman';
}

function cleanChat(s) {
  return String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80);
}

function playerList() {
  return [...S.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, score: p.score, lvl: p.lvl }));
}

function freeColor() {
  const used = new Set([...S.players.values()].map((p) => p.color));
  return PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[S.players.size % PLAYER_COLORS.length];
}

function addChat(name, color, text, sys = false) {
  const li = document.createElement('li');
  if (sys) {
    li.className = 'sys';
    li.textContent = text;
  } else {
    const b = document.createElement('b');
    b.style.color = color;
    b.textContent = name + ': ';
    li.append(b, document.createTextNode(text));
  }
  const log = $('chatLog');
  log.append(li);
  while (log.children.length > 60) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}

// ---------------- UI ----------------
function renderPlayers() {
  const ul = $('players');
  ul.textContent = '';
  const list = [...S.players.values()].sort((a, b) => b.score - a.score);
  for (const p of list) {
    const li = document.createElement('li');
    if (p.id === S.myId) li.className = 'me';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = p.color;
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = p.id === S.myId ? `${p.name} (kamu)` : p.name;
    const sc = document.createElement('span');
    sc.className = 'sc';
    sc.textContent = p.score;
    li.append(dot, nm, sc);
    ul.append(li);
  }
  $('playerCount').textContent = `(${S.players.size}/${MAX_PLAYERS})`;
}
let playersDirty = true;

let hudKey = '';
function updateHud() {
  const w = S.world;
  if (!w) return;
  const key = `${w.sorted}|${w.total}|${w.n}|${Math.floor(w.time)}`;
  if (key === hudKey) return;
  hudKey = key;
  $('hudCount').textContent = `${w.sorted} / ${w.total}`;
  const colors = w.trays.length;
  $('hudSub').textContent = `Level ${w.n} · ${colors} warna · ⏱ ${fmtTime(w.time)}`;
}

function setTool(k) {
  S.input.k = k;
  $('toolSweep').classList.toggle('on', k === 'sweep');
  $('toolGrab').classList.toggle('on', k === 'grab');
}

function showGame() {
  $('lobby').hidden = true;
  $('hud').hidden = false;
  $('bar').hidden = false;
  $('side').hidden = false;
  const online = S.mode !== 'solo';
  $('roomChip').hidden = !online;
  $('roomCode').textContent = S.code || '';
  $('chatWrap').hidden = !online;
  $('btnReshuffle').hidden = S.mode === 'client';
  $('chatLog').textContent = '';
  const wide = window.innerWidth > 900;
  renderer.inset = { top: wide ? 70 : 60, right: wide ? 268 : 12, bottom: wide ? 78 : 100, left: wide ? 16 : 10 };
  playersDirty = true;
}

function backToLobby(msg) {
  S.leaving = true;
  if (S.net) S.net.close();
  S.net = null;
  S.mode = null;
  S.world = null;
  S.players.clear();
  S.remoteTools.clear();
  clearTimeout(S.clearTimer);
  $('clear').hidden = true;
  $('hud').hidden = true;
  $('bar').hidden = true;
  $('side').hidden = true;
  $('lobby').hidden = false;
  setBusy(false);
  $('lobbyStatus').textContent = msg || '';
  updateBest();
  if (location.search.includes('room=')) history.replaceState(null, '', location.pathname + keepParams());
}

function keepParams() {
  const q = new URLSearchParams(location.search);
  q.delete('room');
  const s = q.toString();
  return s ? '?' + s : '';
}

function inviteLink() {
  const q = new URLSearchParams(location.search);
  q.set('room', S.code);
  return location.origin + location.pathname + '?' + q.toString();
}

function updateBest() {
  const best = store.get('best', 0);
  $('bestLine').textContent = best ? `Rekor kamu: sampai level ${best} ✨` : '';
}

function setBusy(b) {
  for (const id of ['btnSolo', 'btnHost']) $(id).disabled = b;
  $('joinForm').querySelector('button').disabled = b;
}

// ---------------- host / solo ----------------
function hostNewLevel(n) {
  const seed = (Math.random() * 1e9) | 0;
  S.world = new World(makeLevel(n, seed));
  S.phase = 'play';
  S.fx = [];
  for (const p of S.players.values()) {
    p.lvl = 0;
    const t = S.world.tool(p.id);
    if (p.input) S.world.setInput(p.id, p.input, true);
    if (p.id === S.myId) t.local = true;
  }
  $('clear').hidden = true;
  if (S.net) S.net.broadcast({ t: 'level', def: S.world.describe() });
  if (S.mode === 'solo' || S.mode === 'host') {
    const best = store.get('best', 0);
    if (n > best) store.set('best', n);
  }
}

function hostHandleEvents() {
  const w = S.world;
  for (const ev of w.events) {
    if (ev.k === 'sort') {
      const p = S.players.get(ev.by);
      if (p) { p.score++; p.lvl = (p.lvl || 0) + 1; playersDirty = true; }
      addSortFx(ev, p);
    } else if (ev.k === 'nope') {
      if (ev.by === S.myId) sfx.nope();
    }
    S.pendingEvents.push(ev);
  }
  w.events.length = 0;
}

function addSortFx(ev, p) {
  S.fx.push({ x: ev.x, y: ev.y, c: ev.c, t0: performance.now(), color: p ? p.color : null });
  if (S.fx.length > 80) S.fx.shift();
  sfx.pop(ev.c);
}

function hostCheckClear() {
  const w = S.world;
  if (S.phase !== 'play' || !w.done) return;
  S.phase = 'clear';
  const info = { t: 'clear', n: w.n, time: w.time, list: playerList() };
  if (S.net) S.net.broadcast(info);
  showClear(info);
  S.clearTimer = setTimeout(() => hostNewLevel(w.n + 1), 5000);
}

function hostSnapshot(now) {
  if (!S.net || now - S.lastSnap < SNAP_MS) return;
  S.lastSnap = now;
  const w = S.world;
  const alive = w.pills.filter((p) => p.alive);
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
  const tl = [];
  for (const t of w.tools.values()) {
    if (!S.players.has(t.pid) || !t.seen) continue;
    tl.push([t.pid, Math.round(t.x), Math.round(t.y), +t.a.toFixed(3), t.kind === 'grab' ? 1 : 0, t.down ? 1 : 0]);
  }
  S.net.broadcast({
    t: 's', b: buf.buffer, time: +w.time.toFixed(3), sorted: w.sorted,
    tc: w.trays.map((t) => t.count), tl,
    sc: [...S.players.values()].map((p) => [p.id, p.score]),
    ev: S.pendingEvents.filter((e) => e.k === 'sort').map((e) => [e.id, e.by, e.c, e.ti, Math.round(e.x), Math.round(e.y)]),
    np: S.pendingEvents.filter((e) => e.k === 'nope').map((e) => [e.ti, e.by]),
  });
  S.pendingEvents.length = 0;
}

const hostHandlers = {
  open(conn) {
    if (S.players.size >= MAX_PLAYERS) {
      conn.send({ t: 'full' });
      setTimeout(() => conn.close(), 300);
      return;
    }
    conn.pid = null;
  },
  data(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      if (conn.pid != null || S.players.size >= MAX_PLAYERS) return;
      const id = S.nextId++;
      conn.pid = id;
      const p = { id, name: cleanName(msg.name), color: freeColor(), score: 0, lvl: 0, conn };
      S.players.set(id, p);
      S.world.tool(id);
      conn.send({ t: 'welcome', id, code: S.code, players: playerList(), def: S.world.describe(), phase: S.phase });
      S.net.broadcast({ t: 'players', list: playerList(), join: p.name }, conn);
      addChat('', '', `${p.name} bergabung 👋`, true);
      toast(`${p.name} bergabung 👋`);
      playersDirty = true;
      return;
    }
    const p = S.players.get(conn.pid);
    if (!p) return;
    if (msg.t === 'in') {
      p.input = msg;
      S.world.setInput(p.id, msg);
    } else if (msg.t === 'emote') {
      const e = EMOTES[msg.e | 0];
      if (!e || performance.now() - (p.lastEmote || 0) < 250) return;
      p.lastEmote = performance.now();
      S.net.broadcast({ t: 'emote', id: p.id, e: msg.e | 0 }, conn);
      spawnEmote(p.id, msg.e | 0);
    } else if (msg.t === 'chat') {
      const m = cleanChat(msg.m);
      if (!m || performance.now() - (p.lastChat || 0) < 600) return;
      p.lastChat = performance.now();
      S.net.broadcast({ t: 'chat', id: p.id, m }, conn);
      showChat(p.id, m);
    }
  },
  close(conn) {
    const p = S.players.get(conn.pid);
    if (!p) return;
    S.players.delete(p.id);
    S.world.removeTool(p.id);
    S.net.broadcast({ t: 'players', list: playerList(), left: p.name });
    addChat('', '', `${p.name} keluar`, true);
    playersDirty = true;
  },
  warn(msg) { toast(msg); },
};

function startSolo(level) {
  S.leaving = false;
  S.mode = 'solo';
  S.code = null;
  S.myId = 0;
  S.players.clear();
  S.players.set(0, { id: 0, name: cleanName($('nameInput').value), color: PLAYER_COLORS[0], score: 0, lvl: 0 });
  hostNewLevel(level);
  showGame();
  portraitHint();
}

function portraitHint() {
  if (window.innerHeight > window.innerWidth && window.innerWidth < 700) toast('Tip: miringkan HP (landscape) biar mejanya lebih besar 📱', 4000);
}

async function startHost(level) {
  setBusy(true);
  $('lobbyStatus').textContent = 'Membuat room…';
  const net = new HostNet(hostHandlers);
  try {
    S.code = await net.start(makeCode());
  } catch (e) {
    setBusy(false);
    $('lobbyStatus').textContent = e.message;
    return;
  }
  S.leaving = false;
  S.net = net;
  S.mode = 'host';
  S.myId = 0;
  S.nextId = 1;
  S.players.clear();
  S.players.set(0, { id: 0, name: cleanName($('nameInput').value), color: PLAYER_COLORS[0], score: 0, lvl: 0 });
  hostNewLevel(level);
  showGame();
  portraitHint();
  addChat('', '', `Room ${S.code} siap. Bagikan kodenya ke teman!`, true);
  history.replaceState(null, '', inviteLink());
  setBusy(false);
}

// ---------------- client ----------------
const clientHandlers = {
  data(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'welcome':
        S.myId = msg.id;
        S.code = msg.code;
        setPlayers(msg.players);
        clientLoadLevel(msg.def);
        S.phase = msg.phase === 'clear' ? 'clear' : 'play';
        if (!$('lobby').hidden) {
          showGame();
          portraitHint();
          addChat('', '', `Masuk ke room ${S.code}. Selamat menyortir!`, true);
        }
        break;
      case 'players':
        setPlayers(msg.list);
        if (msg.join) { toast(`${msg.join} bergabung 👋`); addChat('', '', `${msg.join} bergabung 👋`, true); }
        if (msg.left) addChat('', '', `${msg.left} keluar`, true);
        break;
      case 'level':
        clientLoadLevel(msg.def);
        $('clear').hidden = true;
        break;
      case 's':
        clientSnapshot(msg);
        break;
      case 'clear':
        S.phase = 'clear';
        showClear(msg);
        break;
      case 'emote':
        spawnEmote(msg.id, msg.e | 0);
        break;
      case 'chat':
        showChat(msg.id, cleanChat(msg.m));
        break;
      case 'full':
        backToLobby('Room sudah penuh (maks 10 orang).');
        break;
    }
  },
  close() {
    if (S.leaving) return;
    backToLobby('Host menutup room atau koneksi terputus.');
  },
  warn(msg) { toast(msg); },
};

function setPlayers(list) {
  const old = S.players;
  S.players = new Map();
  for (const p of list) {
    S.players.set(p.id, { id: p.id, name: cleanName(p.name), color: String(p.color).slice(0, 9), score: p.score | 0, lvl: p.lvl | 0 });
  }
  for (const id of S.remoteTools.keys()) if (!S.players.has(id)) S.remoteTools.delete(id);
  if (old !== S.players) playersDirty = true;
}

function clientLoadLevel(def) {
  S.world = new World(def);
  S.phase = 'play';
  S.fx = [];
}

function clientSnapshot(msg) {
  const w = S.world;
  if (!w) return;
  w.time = +msg.time || 0;
  w.sorted = msg.sorted | 0;
  if (Array.isArray(msg.tc)) msg.tc.forEach((c, i) => { if (w.trays[i]) w.trays[i].count = c | 0; });
  let raw = msg.b;
  if (raw && ArrayBuffer.isView(raw)) raw = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  if (raw instanceof ArrayBuffer) {
    const buf = new Int16Array(raw);
    for (const p of w.pills) p.seen = false;
    for (let i = 0; i + 3 < buf.length; i += 4) {
      const id = buf[i] & 0x3fff;
      const p = w.byId.get(id);
      if (!p) continue;
      p.seen = true;
      p.held = buf[i] & 0x4000 ? 1 : -1;
      p.x = buf[i + 1] / 8;
      p.y = buf[i + 2] / 8;
      p.a = buf[i + 3] / 10000;
    }
    for (const p of w.pills) if (!p.seen) p.alive = false;
  }
  if (Array.isArray(msg.tl)) {
    for (const [pid, x, y, a, k, d] of msg.tl) {
      if (pid === S.myId) continue;
      let t = S.remoteTools.get(pid);
      if (!t) { t = { x, y, a }; S.remoteTools.set(pid, t); }
      t.tx = x; t.ty = y; t.ta = a; t.kind = k ? 'grab' : 'sweep'; t.down = !!d;
    }
  }
  if (Array.isArray(msg.sc)) {
    for (const [pid, sc] of msg.sc) {
      const p = S.players.get(pid);
      if (p && p.score !== sc) { p.score = sc; playersDirty = true; }
    }
  }
  if (Array.isArray(msg.ev)) {
    for (const [, by, c, ti, x, y] of msg.ev) {
      const tr = w.trays[ti];
      if (tr) tr.flash = 0.35;
      addSortFx({ x, y, c }, S.players.get(by));
    }
  }
  if (Array.isArray(msg.np)) {
    for (const [ti, by] of msg.np) {
      if (w.trays[ti]) w.trays[ti].nope = 0.4;
      if (by === S.myId) sfx.nope();
    }
  }
}

async function joinRoom(code) {
  code = cleanCode(code);
  if (code.length !== 4) { $('lobbyStatus').textContent = 'Kode room terdiri dari 4 huruf.'; return; }
  setBusy(true);
  $('lobbyStatus').textContent = 'Menyambung ke room ' + code + '…';
  S.leaving = false;
  S.mode = 'client';
  S.code = code;
  const net = new ClientNet(clientHandlers);
  S.net = net;
  try {
    await net.connect(code);
    net.send({ t: 'hello', name: cleanName($('nameInput').value) });
    setTimeout(() => {
      if (S.net === net && !S.world) backToLobby('Room tidak merespons. Coba lagi ya.');
    }, 8000);
  } catch (e) {
    S.net = null;
    S.mode = null;
    setBusy(false);
    $('lobbyStatus').textContent = e.message;
  }
}

// ---------------- shared social bits ----------------
function toolPos(pid) {
  if (pid === S.myId) return { x: S.input.x, y: S.input.y };
  if (S.mode === 'client') return S.remoteTools.get(pid);
  return S.world && S.world.tools.get(pid);
}

function spawnEmote(pid, idx) {
  const pos = toolPos(pid);
  if (!pos || !EMOTES[idx]) return;
  S.emotes.push({ x: pos.x, y: pos.y, e: EMOTES[idx], t0: performance.now() });
  if (S.emotes.length > 40) S.emotes.shift();
}

function showChat(pid, m) {
  if (!m) return;
  const p = S.players.get(pid);
  if (!p) return;
  addChat(p.name, p.color, m);
  S.bubbles.set(pid, { text: m, until: performance.now() + 4500 });
}

function sendEmote(idx) {
  if (!S.mode) return;
  if (S.mode === 'client') S.net.send({ t: 'emote', e: idx });
  else {
    if (S.net) S.net.broadcast({ t: 'emote', id: S.myId, e: idx });
    spawnEmote(S.myId, idx);
  }
  if (S.mode === 'client') spawnEmote(S.myId, idx);
}

function sendChat(m) {
  m = cleanChat(m);
  if (!m || !S.mode || S.mode === 'solo') return;
  if (S.mode === 'client') S.net.send({ t: 'chat', m });
  else S.net.broadcast({ t: 'chat', id: S.myId, m });
  showChat(S.myId, m);
}

function showClear(info) {
  $('clearTitle').textContent = `Level ${info.n} beres! ✨`;
  $('clearTime').textContent = `Waktu: ${fmtTime(info.time)}`;
  const ol = $('clearList');
  ol.textContent = '';
  const list = (info.list || []).slice().sort((a, b) => (b.lvl | 0) - (a.lvl | 0));
  if (list.length > 1) {
    for (const p of list) {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.style.color = p.color;
      b.textContent = cleanName(p.name);
      li.append(b, document.createTextNode(` — ${p.lvl | 0} pil`));
      ol.append(li);
    }
  }
  $('clear').hidden = false;
  sfx.clear();
  let left = 5;
  const tick = () => {
    $('clearNext').textContent = left > 0 ? `Level ${info.n + 1} (meja lebih luas) mulai dalam ${left}…` : 'Menyiapkan meja…';
    left--;
    if (left >= 0 && !$('clear').hidden) setTimeout(tick, 1000);
  };
  tick();
}

// ---------------- input ----------------
const cv = $('cv');
let pointerType = 'mouse';
let rotDir = 0;

function pointerToWorld(e) {
  S.hasPointer = true;
  const offset = e.pointerType === 'touch' ? 46 : 0; // keep the hand visible above the finger
  const p = renderer.toWorld(e.clientX, e.clientY - offset);
  S.input.x = p.x;
  S.input.y = p.y;
}

cv.addEventListener('pointermove', (e) => { pointerType = e.pointerType; pointerToWorld(e); });
cv.addEventListener('pointerdown', (e) => {
  ac();
  pointerType = e.pointerType;
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  if (e.button === 2) { setTool(S.input.k === 'sweep' ? 'grab' : 'sweep'); return; }
  pointerToWorld(e);
  S.input.d = true;
  cv.setPointerCapture(e.pointerId);
});
const release = () => { S.input.d = false; };
cv.addEventListener('pointerup', release);
cv.addEventListener('pointercancel', release);
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  S.input.a += Math.sign(e.deltaY) * 0.14;
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (!S.mode) return;
  const typing = document.activeElement === $('chatInput');
  if (typing) {
    if (e.key === 'Escape') $('chatInput').blur();
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 'q') rotDir = -1;
  else if (k === 'e') rotDir = 1;
  else if (e.code === 'Space') { e.preventDefault(); setTool(S.input.k === 'sweep' ? 'grab' : 'sweep'); }
  else if (k >= '1' && k <= '6') sendEmote(+k - 1);
  else if (e.key === 'Enter' && S.mode !== 'solo') { e.preventDefault(); $('chatInput').focus(); }
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if ((k === 'q' && rotDir < 0) || (k === 'e' && rotDir > 0)) rotDir = 0;
});
window.addEventListener('blur', () => { rotDir = 0; S.input.d = false; });

function holdButton(el, dir) {
  const stop = () => { rotDir = 0; };
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); rotDir = dir; });
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointerleave', stop);
  el.addEventListener('pointercancel', stop);
}
holdButton($('rotL'), -1);
holdButton($('rotR'), 1);
$('toolSweep').addEventListener('click', () => setTool('sweep'));
$('toolGrab').addEventListener('click', () => setTool('grab'));

EMOTES.forEach((e, i) => {
  const b = document.createElement('button');
  b.textContent = e;
  b.title = `Emote (${i + 1})`;
  b.addEventListener('click', () => sendEmote(i));
  $('emotes').append(b);
});

$('chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  sendChat($('chatInput').value);
  $('chatInput').value = '';
  $('chatInput').blur();
});

$('btnLeave').addEventListener('click', () => backToLobby(''));
$('btnSide').addEventListener('click', () => $('side').classList.toggle('open'));
$('btnReshuffle').addEventListener('click', () => {
  if (S.mode === 'client' || !S.world || S.phase !== 'play') return;
  hostNewLevel(S.world.n);
  toast('Level diacak ulang');
});
$('btnCopy').addEventListener('click', async () => {
  const link = inviteLink();
  try {
    await navigator.clipboard.writeText(link);
    toast('Link undangan disalin! Kirim ke teman 💌');
  } catch {
    toast(link, 6000);
  }
});
function syncSoundBtn() { $('btnSound').textContent = S.muted ? '🔇' : '🔊'; }
$('btnSound').addEventListener('click', () => { S.muted = !S.muted; store.set('muted', S.muted); syncSoundBtn(); });
syncSoundBtn();

// ---------------- lobby ----------------
$('nameInput').value = store.get('name', '');
$('nameInput').addEventListener('change', () => store.set('name', cleanName($('nameInput').value)));
function chosenLevel() {
  return Math.max(1, Math.min(30, parseInt($('levelInput').value, 10) || 1));
}
function ensureName() {
  if (!$('nameInput').value.trim()) $('nameInput').value = 'Pil' + Math.floor(Math.random() * 900 + 100);
  store.set('name', cleanName($('nameInput').value));
}
$('btnSolo').addEventListener('click', () => { ac(); ensureName(); startSolo(chosenLevel()); });
$('btnHost').addEventListener('click', () => { ac(); ensureName(); startHost(chosenLevel()); });
$('joinForm').addEventListener('submit', (e) => { e.preventDefault(); ac(); ensureName(); joinRoom($('codeInput').value); });
$('codeInput').addEventListener('input', () => { $('codeInput').value = cleanCode($('codeInput').value); });

const roomParam = cleanCode(new URLSearchParams(location.search).get('room'));
if (roomParam) {
  $('codeInput').value = roomParam;
  $('lobbyStatus').textContent = `Kamu diundang ke room ${roomParam}. Isi nama lalu tekan Gabung.`;
}
updateBest();

// ---------------- main loop ----------------
let last = performance.now();
let acc = 0;
const STEP = 1 / 60;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const w = S.world;

  if (rotDir) S.input.a += rotDir * 3 * dt;
  if (S.input.a > Math.PI) S.input.a -= Math.PI * 2;
  if (S.input.a < -Math.PI) S.input.a += Math.PI * 2;

  if (w && (S.mode === 'solo' || S.mode === 'host')) {
    const t = w.tool(S.myId);
    t.local = true;
    if (S.hasPointer) {
      S.players.get(S.myId).input = { ...S.input };
      w.setInput(S.myId, S.input);
    }
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 4) {
      if (S.phase === 'play') w.step(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps === 4) acc = 0;
    hostHandleEvents();
    hostCheckClear();
    hostSnapshot(now);
  } else if (w && S.mode === 'client') {
    w.time += S.phase === 'play' ? dt : 0;
    w.updateTrays();
    const k = 1 - Math.exp(-dt * 18);
    for (const p of w.pills) {
      if (!p.alive) continue;
      p.rx += (p.x - p.rx) * k;
      p.ry += (p.y - p.ry) * k;
      let da = p.a - p.ra;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      p.ra += da * k;
    }
    for (const t of S.remoteTools.values()) {
      if (t.tx == null) continue;
      t.x += (t.tx - t.x) * k;
      t.y += (t.ty - t.y) * k;
      let da = t.ta - t.a;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      t.a += da * k;
    }
    for (const tr of w.trays) { tr.flash = Math.max(0, tr.flash - dt); tr.nope = Math.max(0, tr.nope - dt); }
    const key = `${Math.round(S.input.x)}|${Math.round(S.input.y)}|${S.input.a.toFixed(2)}|${S.input.k}|${S.input.d}`;
    if (S.hasPointer && key !== S.lastInputKey && now - S.lastInputSent > INPUT_MS) {
      S.lastInputKey = key;
      S.lastInputSent = now;
      S.net.send({ t: 'in', x: Math.round(S.input.x), y: Math.round(S.input.y), a: +S.input.a.toFixed(3), k: S.input.k, d: S.input.d ? 1 : 0 });
    }
  }

  if (playersDirty && S.mode) { renderPlayers(); playersDirty = false; }
  updateHud();

  // Build the list of hands to draw.
  const tools = [];
  if (w) {
    for (const p of S.players.values()) {
      let src;
      if (p.id === S.myId) src = S.hasPointer ? { x: S.input.x, y: S.input.y, a: S.input.a, kind: S.input.k, down: S.input.d } : null;
      else if (S.mode === 'client') src = S.remoteTools.get(p.id);
      else src = w.tools.get(p.id);
      if (!src || src.x == null || src.seen === 0) continue;
      tools.push({ x: src.x, y: src.y, a: src.a, kind: src.kind, down: src.down, color: p.color, name: p.name, me: p.id === S.myId, bubble: S.bubbles.get(p.id) });
    }
    // Draw my own hand last so it is always on top.
    tools.sort((a, b) => (a.me ? 1 : 0) - (b.me ? 1 : 0));
  }
  S.fx = S.fx.filter((f) => now - f.t0 < 900);
  S.emotes = S.emotes.filter((e) => now - e.t0 < 1600);
  renderer.draw(w, { now, tools, fx: S.fx, emotes: S.emotes, showOwnTag: S.mode !== 'solo' });
  requestAnimationFrame(frame);
}

function onResize() {
  renderer.resize();
  if (S.mode) {
    const wide = window.innerWidth > 900;
    renderer.inset = { top: wide ? 70 : 60, right: wide ? 268 : 12, bottom: wide ? 78 : 100, left: wide ? 16 : 10 };
  }
}
window.addEventListener('resize', onResize);
onResize();
requestAnimationFrame(frame);

// Exposed for automated tests.
window.__pilahpil = { S, PILL_COLORS };

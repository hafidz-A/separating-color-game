import { PILL_COLORS } from './levels.js';
import { Renderer } from './render3d.js';
import pillMode from './modes/pill.js';
import puzzleMode from './modes/puzzle.js';
import golfMode from './modes/golf.js';
import { PuzzleScene } from './scenes/puzzle.js';
import { GolfScene } from './scenes/golf.js';
import { HostNet, ClientNet, makeCode, cleanCode, diagnose } from './net.js';
import { CamHub } from './cam.js';

const $ = (id) => document.getElementById(id);
const PLAYER_COLORS = ['#ff6fa3', '#4fd2ff', '#ffcb47', '#86ee8a', '#c08bff', '#ff9a5c', '#5af0d2', '#ff6be0', '#a7b6ff', '#f2f2f2'];
const EMOTES = ['💗', '🤣', '👏', '🔥', '😴', '🫶'];
const MODES = { pill: pillMode, puzzle: puzzleMode, golf: golfMode };
const MODE_IDS = Object.keys(MODES);
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
  input: { x: 0, y: 0, a: -0.6, k: 'sweep', d: false, q: 0 },
  gamePref: 'random',
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
  chatHistory: [],
  unread: 0,
  hasPointer: false,
};

const renderer = new Renderer($('cv'), $('ov'));
renderer.registerScene('puzzle', new PuzzleScene());
renderer.registerScene('golf', new GolfScene());

const cams = new CamHub({
  peer: () => (S.net ? S.net.peer : null),
  players: () => S.players,
  myId: () => S.myId,
  toast: (m) => toast(m, 3500),
  onLayout: () => {},
  onState(on) {
    $('btnCam').classList.toggle('on', on);
    $('btnCam').title = on ? 'Matikan kamera' : 'Nyalakan kamera (tanpa suara)';
    if (!S.mode || S.mode === 'solo') return;
    if (S.mode === 'client') S.net.send({ t: 'cam', on });
    else {
      const me = S.players.get(S.myId);
      if (me) me.cam = on;
      S.net.broadcast({ t: 'players', list: playerList() });
    }
  },
});

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
  snap() { tone(660, 0.06, 'square', 0.035); tone(990, 0.1, 'sine', 0.06, 0.05); },
  hole() { [0, 5, 9].forEach((st, i) => tone(700 * Math.pow(2, st / 12), 0.14, 'sine', 0.07, i * 0.07)); },
  shot() { tone(300, 0.05, 'triangle', 0.08); },
  splash() { tone(140, 0.25, 'sawtooth', 0.03); tone(90, 0.3, 'sine', 0.06, 0.05); },
  msg() { tone(880, 0.07, 'sine', 0.06); tone(1175, 0.09, 'sine', 0.06, 0.07); },
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
  return String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 100);
}

function playerList() {
  return [...S.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, score: p.score, lvl: p.lvl, peer: p.peer || '', cam: !!p.cam }));
}

function freeColor() {
  const used = new Set([...S.players.values()].map((p) => p.color));
  return PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[S.players.size % PLAYER_COLORS.length];
}

function addChat(name, color, text, sys = false, mine = false) {
  const li = document.createElement('li');
  if (mine) li.className = 'mine';
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
  const mode = MODES[w.mode];
  const info = mode.hud(w, S.myId);
  const key = `${w.mode}|${info.count}|${info.sub}|${w.n}|${Math.floor(w.time)}`;
  if (key === hudKey) return;
  hudKey = key;
  $('hudCount').textContent = info.count;
  $('hudSub').textContent = `${mode.icon} Level ${w.n} · ${info.sub} · ⏱ ${fmtTime(w.time)}`;
}

// Show the controls, colours and title card that fit the current game.
let uiMode = null;
function applyModeUI(w, announce) {
  const mode = MODES[w.mode];
  document.body.dataset.game = w.mode;
  if (uiMode !== w.mode) {
    uiMode = w.mode;
    $('toolSweep').hidden = !mode.ui.tools;
    $('toolGrab').hidden = !mode.ui.tools;
    const rot = !!mode.ui.rotate && (w.mode !== 'puzzle' || w.rot);
    $('rotL').hidden = !rot;
    $('rotR').hidden = !rot;
    $('hint').textContent = mode.hint;
  } else {
    const rot = !!mode.ui.rotate && (w.mode !== 'puzzle' || w.rot);
    $('rotL').hidden = !rot;
    $('rotR').hidden = !rot;
  }
  $('rotL').parentElement.classList.toggle('empty', !mode.ui.tools && $('rotL').hidden);
  if (announce) {
    const b = $('banner');
    b.querySelector('.b-icon').textContent = mode.icon;
    b.querySelector('.b-name').textContent = mode.name;
    b.querySelector('.b-level').textContent = `Level ${w.n}`;
    b.querySelector('.b-hint').textContent = mode.hint;
    b.hidden = false;
    b.classList.remove('go');
    void b.offsetWidth;
    b.classList.add('go');
    clearTimeout(applyModeUI.t);
    applyModeUI.t = setTimeout(() => { b.hidden = true; }, 3200);
  }
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
  $('btnCam').hidden = !online;
  $('chatLog').textContent = '';
  $('feed').textContent = '';
  $('side').classList.remove('open');
  $('sideIcon').textContent = online ? '💬' : '👥';
  setUnread(0);
  playersDirty = true;
}

function backToLobby(msg) {
  S.leaving = true;
  if (S.net) S.net.close();
  S.net = null;
  S.mode = null;
  S.world = null;
  cams.reset();
  delete document.body.dataset.game;
  uiMode = null;
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
function pickMode(sameAs) {
  if (sameAs) return sameAs;
  if (S.gamePref !== 'random' && MODES[S.gamePref]) return S.gamePref;
  const last = S.world ? S.world.mode : null;
  const options = MODE_IDS.filter((m) => m !== last);
  return options[Math.floor(Math.random() * options.length)];
}

function hostNewLevel(n, sameMode) {
  const seed = (Math.random() * 1e9) | 0;
  const mode = MODES[pickMode(sameMode)];
  S.world = mode.create(mode.makeDef(n, seed));
  S.phase = 'play';
  S.fx = [];
  for (const p of S.players.values()) {
    p.lvl = 0;
    S.world.join(p.id);
    if (p.input && S.world.mode === 'pill') S.world.setInput(p.id, p.input, true);
    if (p.id === S.myId && S.world.tools.get(p.id)) S.world.tools.get(p.id).local = true;
  }
  $('clear').hidden = true;
  applyModeUI(S.world, true);
  if (S.net) S.net.broadcast({ t: 'level', def: S.world.describe() });
  if (S.mode === 'solo' || S.mode === 'host') {
    const best = store.get('best', 0);
    if (n > best) store.set('best', n);
  }
}

function hostHandleEvents() {
  const w = S.world;
  for (const ev of w.events) {
    if (ev.k === 'point') {
      const p = S.players.get(ev.by);
      const pts = ev.pts | 0;
      if (p && pts) { p.score += pts; p.lvl = (p.lvl || 0) + pts; playersDirty = true; }
    }
    showEvent(ev);
    S.pendingEvents.push(ev);
  }
  w.events.length = 0;
}

// Visual + sound feedback for a game event (host and guests alike).
function showEvent(ev) {
  const w = S.world;
  if (w && w.applyEvent) w.applyEvent(ev);
  const p = S.players.get(ev.by);
  if (ev.k === 'point') {
    S.fx.push({ x: ev.x, y: ev.y, c: ev.c, ring: ev.ring, text: ev.text || `+${ev.pts | 0 || 1}`, t0: performance.now(), color: p ? p.color : null });
    if (S.fx.length > 80) S.fx.shift();
    if (ev.sfx === 'snap') sfx.snap();
    else if (ev.sfx === 'hole') sfx.hole();
    else sfx.pop(ev.c | 0);
  } else if (ev.k === 'nope') {
    if (ev.by === S.myId) sfx.nope();
  } else if (ev.k === 'shot') {
    sfx.shot();
  } else if (ev.k === 'splash') {
    sfx.splash();
    S.fx.push({ x: ev.x, y: ev.y, ring: '#4fc3ff', text: 'Byur! +1', t0: performance.now(), color: '#2f8fd6' });
  }
}

function hostCheckClear() {
  const w = S.world;
  if (S.phase !== 'play' || !w.done) return;
  S.phase = 'clear';
  const nextHint = S.gamePref === 'random' ? 'permainan acak' : `${MODES[S.gamePref].name}, lebih susah`;
  const info = { t: 'clear', n: w.n, mode: w.mode, nextHint, time: w.time, list: playerList() };
  if (S.net) S.net.broadcast(info);
  showClear(info);
  S.clearTimer = setTimeout(() => hostNewLevel(w.n + 1), 5000);
}

function hostSnapshot(now) {
  if (!S.net || now - S.lastSnap < SNAP_MS) return;
  S.lastSnap = now;
  const w = S.world;
  const tl = [];
  for (const t of w.tools.values()) {
    if (!S.players.has(t.pid) || !t.seen) continue;
    tl.push([t.pid, Math.round(t.x), Math.round(t.y), +t.a.toFixed(3), t.kind === 'grab' ? 1 : 0, t.down ? 1 : 0]);
  }
  const ev = S.pendingEvents.map((e) => ({
    k: e.k, by: e.by, x: Math.round(e.x || 0), y: Math.round(e.y || 0), ring: e.ring, pts: e.pts, sfx: e.sfx, c: e.c, ti: e.ti, text: e.text,
  }));
  S.net.broadcast({
    t: 's', mode: w.mode, time: +w.time.toFixed(3), tl,
    sc: [...S.players.values()].map((p) => [p.id, p.score]),
    ev, ...w.snapshot(),
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
      const p = { id, name: cleanName(msg.name), color: freeColor(), score: 0, lvl: 0, conn, peer: conn.peer, cam: false };
      S.players.set(id, p);
      S.world.join(id);
      conn.send({ t: 'welcome', id, code: S.code, players: playerList(), def: S.world.describe(), phase: S.phase, hist: S.chatHistory });
      S.net.broadcast({ t: 'players', list: playerList(), join: p.name }, conn);
      cams.sync();
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
    } else if (msg.t === 'cam') {
      p.cam = !!msg.on;
      S.net.broadcast({ t: 'players', list: playerList() });
      cams.sync();
      playersDirty = true;
    }
  },
  call(c) { cams.handleCall(c); },
  close(conn) {
    const p = S.players.get(conn.pid);
    if (!p) return;
    S.players.delete(p.id);
    S.world.leave(p.id);
    S.net.broadcast({ t: 'players', list: playerList(), left: p.name });
    cams.sync();
    addChat('', '', `${p.name} keluar`, true);
    playersDirty = true;
  },
  warn(msg) { toast(msg); },
  status(st) {
    if (st === 'away') toast('Room sempat terputus, menyambung ulang…', 3000);
    else toast('Room aktif lagi ✅ Teman bisa masuk sekarang', 3000);
  },
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
  if (matchMedia('(pointer: coarse)').matches) toast('1 jari = dorong · 2 jari = putar spatula ✌️', 4000);
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
  S.chatHistory = [];
  S.players.clear();
  S.players.set(0, { id: 0, name: cleanName($('nameInput').value), color: PLAYER_COLORS[0], score: 0, lvl: 0, peer: net.peer.id, cam: false });
  hostNewLevel(level);
  showGame();
  portraitHint();
  addChat('', '', `Room ${S.code} siap. Bagikan kodenya ke teman!`, true);
  addChat('', '', 'Biarkan halaman ini tetap terbuka. Kalau kamu pindah aplikasi, teman baru bisa masuk setelah kamu balik ke sini.', true);
  setTimeout(() => toast('Tetap di halaman ini ya, biar teman bisa masuk 🙌', 4500), 1200);
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
          if (Array.isArray(msg.hist)) {
            for (const h of msg.hist.slice(-30)) {
              if (h && typeof h === 'object') addChat(cleanName(h.name), String(h.color).slice(0, 9), cleanChat(h.m));
            }
          }
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
  call(c) { cams.handleCall(c); },
};

function setPlayers(list) {
  const old = S.players;
  S.players = new Map();
  for (const p of list) {
    S.players.set(p.id, {
      id: p.id, name: cleanName(p.name), color: String(p.color).slice(0, 9), score: p.score | 0, lvl: p.lvl | 0,
      peer: String(p.peer || '').slice(0, 80), cam: !!p.cam,
    });
  }
  cams.sync();
  for (const id of S.remoteTools.keys()) if (!S.players.has(id)) S.remoteTools.delete(id);
  if (old !== S.players) playersDirty = true;
}

function clientLoadLevel(def) {
  const mode = def && MODES[def.mode || 'pill'];
  if (!mode) return;
  S.world = mode.create(def);
  S.phase = 'play';
  S.fx = [];
  S.remoteTools.clear();
  applyModeUI(S.world, true);
}

function clientSnapshot(msg) {
  const w = S.world;
  if (!w || (msg.mode && msg.mode !== w.mode)) return;
  w.time = +msg.time || 0;
  w.applySnapshot(msg);
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
    for (const ev of msg.ev) {
      if (!ev || typeof ev !== 'object') continue;
      showEvent({
        k: String(ev.k), by: ev.by, x: +ev.x || 0, y: +ev.y || 0, pts: ev.pts | 0, c: ev.c | 0, ti: ev.ti,
        ring: /^#[0-9a-f]{3,8}$/i.test(ev.ring || '') ? ev.ring : undefined,
        sfx: typeof ev.sfx === 'string' ? ev.sfx : undefined,
        text: typeof ev.text === 'string' ? ev.text.slice(0, 20) : undefined,
      });
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
    await net.connect(code, (st) => { $('lobbyStatus').textContent = st; });
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

const QUICK = ['Ayo! 💪', 'Mantap 👍', 'Bantuin dong 🙏', 'Aku bagian kiri', 'Kamu bagian kanan', 'Hampir! 🔥', 'Hehe 😆', 'GG ✨'];

function chatOpen() {
  return window.innerWidth > 900 || $('side').classList.contains('open');
}

function setUnread(n) {
  S.unread = n;
  $('unread').hidden = n <= 0;
  $('unread').textContent = n > 9 ? '9+' : String(n);
}

// Short-lived message pills over the table, for phones with the chat closed.
function pushFeed(p, m) {
  const feed = $('feed');
  const el = document.createElement('div');
  el.className = 'feed-msg';
  const b = document.createElement('b');
  b.style.color = p.color;
  b.textContent = p.name + ' ';
  el.append(b, document.createTextNode(m));
  feed.append(el);
  while (feed.children.length > 3) feed.firstChild.remove();
  setTimeout(() => el.classList.add('out'), 5500);
  setTimeout(() => el.remove(), 6000);
}

function showChat(pid, m) {
  if (!m) return;
  const p = S.players.get(pid);
  if (!p) return;
  addChat(p.name, p.color, m, false, pid === S.myId);
  S.bubbles.set(pid, { text: m, until: performance.now() + 4500 });
  cams.say(pid, m);
  if (S.mode === 'host') {
    S.chatHistory.push({ name: p.name, color: p.color, m });
    if (S.chatHistory.length > 30) S.chatHistory.shift();
  }
  if (pid !== S.myId) {
    sfx.msg();
    if (!chatOpen()) { setUnread(S.unread + 1); pushFeed(p, m); }
  }
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
  const mode = MODES[info.mode] || MODES.pill;
  const unit = info.mode === 'puzzle' ? 'keping' : info.mode === 'golf' ? 'poin' : 'pil';
  $('clearTitle').textContent = `${mode.icon} ${mode.name} beres! ✨`;
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
      li.append(b, document.createTextNode(` — ${p.lvl | 0} ${unit}`));
      ol.append(li);
    }
  }
  $('clear').hidden = false;
  sfx.clear();
  let left = 5;
  const tick = () => {
    $('clearNext').textContent = left > 0 ? `Level ${info.n + 1} (${info.nextHint || 'permainan acak'}) mulai dalam ${left}…` : 'Menyiapkan permainan…';
    left--;
    if (left >= 0 && !$('clear').hidden) setTimeout(tick, 1000);
  };
  tick();
}

// ---------------- input ----------------
const cv = $('cv');
let pointerType = 'mouse';
let rotDir = 0;
const curGame = () => (S.world ? S.world.mode : null);
// Puzzle pieces turn in quarter steps; the counter travels with the input.
let lastStep = 0;
function stepRotate(dir) {
  const now = performance.now();
  if (now - lastStep < 160) return;
  lastStep = now;
  S.input.q = (S.input.q | 0) + dir;
}
let twistAcc = 0;

function pointerToWorld(e) {
  S.hasPointer = true;
  const offset = e.pointerType === 'touch' ? 46 : 0; // keep the hand visible above the finger
  const p = renderer.toWorld(e.clientX, e.clientY - offset);
  S.input.x = p.x;
  S.input.y = p.y;
}

// Touch: one finger moves and pushes, a second finger twists the spatula.
const touches = new Map();
let twistAngle = null;
let primaryId = null;
function twist() {
  const [a, b] = [...touches.values()];
  return Math.atan2(b.y - a.y, b.x - a.x);
}

cv.addEventListener('pointermove', (e) => {
  pointerType = e.pointerType;
  if (touches.has(e.pointerId)) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size >= 2 && twistAngle != null) {
      const ang = twist();
      let d = ang - twistAngle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (curGame() === 'pill') S.input.a += d;
      else if (curGame() === 'puzzle') {
        twistAcc += d;
        if (Math.abs(twistAcc) > 0.7) { stepRotate(Math.sign(twistAcc)); twistAcc = 0; }
      }
      twistAngle = ang;
      return;
    }
    if (e.pointerId !== primaryId) return;
  }
  pointerToWorld(e);
});
cv.addEventListener('pointerdown', (e) => {
  ac();
  pointerType = e.pointerType;
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  $('emotes').classList.remove('open');
  if (e.button === 2) {
    if (curGame() === 'pill') setTool(S.input.k === 'sweep' ? 'grab' : 'sweep');
    else if (curGame() === 'puzzle') stepRotate(1);
    return;
  }
  try { cv.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size >= 2) {
      // Second finger: rotate instead of pushing.
      S.input.d = false;
      twistAngle = twist();
      twistAcc = 0;
      return;
    }
    primaryId = e.pointerId;
  }
  pointerToWorld(e);
  S.input.d = true;
});
const release = (e) => {
  if (touches.delete(e.pointerId)) {
    if (touches.size < 2) twistAngle = null;
    if (e.pointerId === primaryId) primaryId = null;
    S.input.d = false;
    return;
  }
  S.input.d = false;
};
cv.addEventListener('pointerup', release);
cv.addEventListener('pointercancel', release);
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (curGame() === 'puzzle') stepRotate(Math.sign(e.deltaY));
  else S.input.a += Math.sign(e.deltaY) * 0.14;
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (!S.mode) return;
  const typing = document.activeElement === $('chatInput');
  if (typing) {
    if (e.key === 'Escape') $('chatInput').blur();
    return;
  }
  const k = e.key.toLowerCase();
  if ((k === 'q' || k === 'e') && curGame() === 'puzzle') { if (!e.repeat) stepRotate(k === 'q' ? -1 : 1); }
  else if (k === 'q') rotDir = -1;
  else if (k === 'e') rotDir = 1;
  else if (e.code === 'Space') { e.preventDefault(); if (curGame() === 'pill') setTool(S.input.k === 'sweep' ? 'grab' : 'sweep'); }
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
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (curGame() === 'puzzle') { lastStep = 0; stepRotate(dir); } else rotDir = dir;
  });
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
  b.addEventListener('click', () => { sendEmote(i); $('emotes').classList.remove('open'); });
  $('emotes').append(b);
});

$('chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  sendChat($('chatInput').value);
  $('chatInput').value = '';
  $('chatInput').blur();
});

$('btnLeave').addEventListener('click', () => backToLobby(''));
$('btnSide').addEventListener('click', () => {
  const open = $('side').classList.toggle('open');
  if (open) {
    setUnread(0);
    $('feed').textContent = '';
    const log = $('chatLog');
    log.scrollTop = log.scrollHeight;
  }
});
QUICK.forEach((q) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = q;
  b.addEventListener('click', () => sendChat(q));
  $('quick').append(b);
});
$('btnReshuffle').addEventListener('click', () => {
  if (S.mode === 'client' || !S.world || S.phase !== 'play') return;
  hostNewLevel(S.world.n, S.world.mode);
  toast('Level diacak ulang');
});
$('btnCopy').addEventListener('click', async () => {
  const link = inviteLink();
  try {
    await navigator.clipboard.writeText(link);
    toast('Link disalin 💌 Habis kirim, langsung balik ke sini ya biar temanmu bisa masuk', 4500);
  } catch {
    toast(link, 6000);
  }
});
$('btnCam').addEventListener('click', () => {
  if (cams.on) cams.stop();
  else cams.start();
});
$('btnEmote').addEventListener('click', () => $('emotes').classList.toggle('open'));
const canFull = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
$('btnFull').hidden = !(canFull && matchMedia('(pointer: coarse)').matches);
$('btnFull').addEventListener('click', () => {
  const d = document;
  if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  else {
    const el = d.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    Promise.resolve(req.call(el)).catch(() => toast('Layar penuh tidak didukung di browser ini'));
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
function readGamePref() {
  const v = $('gameInput').value;
  S.gamePref = MODES[v] ? v : 'random';
  store.set('game', S.gamePref);
}
$('gameInput').value = store.get('game', 'random');
$('btnSolo').addEventListener('click', () => { ac(); ensureName(); readGamePref(); startSolo(chosenLevel()); });
$('btnHost').addEventListener('click', () => { ac(); ensureName(); readGamePref(); startHost(chosenLevel()); });
$('joinForm').addEventListener('submit', (e) => { e.preventDefault(); ac(); ensureName(); joinRoom($('codeInput').value); });
$('codeInput').addEventListener('input', () => { $('codeInput').value = cleanCode($('codeInput').value); });

// ---------------- connection check ----------------
async function runCheck() {
  const list = $('checkList');
  list.hidden = false;
  $('btnCheck').disabled = true;
  const row = (ok, running, text) => {
    const li = document.createElement('li');
    const icon = document.createElement('span');
    icon.textContent = running ? '⏳' : ok ? '✅' : '❌';
    const t = document.createElement('span');
    t.textContent = text;
    li.append(icon, t);
    return li;
  };
  const draw = (r) => {
    list.textContent = '';
    list.append(
      row(r.webrtc, false, 'Browser mendukung main bareng (WebRTC)'),
      row(r.server, r.running === 'server', 'Bisa menghubungi server room'),
      row(r.direct, r.running === 'server' || r.running === 'ice', 'Jalur langsung antar HP (STUN)'),
      row(r.relay, r.running === 'server' || r.running === 'ice', 'Jalur cadangan / relay (TURN)'),
    );
    if (r.relayInfo && r.relayInfo.configured) {
      list.append(row(r.relayInfo.ok, false, 'Tiket relay dari Worker: ' + (r.relayInfo.detail || '-')));
    }
    if (!r.running) {
      const tip = document.createElement('li');
      const sp = document.createElement('span');
      sp.className = 'tip';
      if (!r.webrtc) sp.textContent = 'Browser ini tidak mendukung. Coba buka di Chrome atau Safari terbaru (bukan browser bawaan aplikasi).';
      else if (!r.server) sp.textContent = 'Jaringan ini tidak bisa menghubungi server room. Coba ganti Wi-Fi ↔ data seluler, matikan VPN / DNS khusus, lalu cek lagi.';
      else if (r.relayInfo && r.relayInfo.configured && !r.relayInfo.ok) {
        const d = r.relayInfo.detail || '';
        sp.textContent = /HTTP 500/.test(d) ? 'Worker: variabel TURN_KEY_ID / TURN_KEY_API_TOKEN belum terisi, atau belum di-Deploy setelah diisi.'
          : /HTTP 502/.test(d) ? 'Worker: Cloudflare menolak kuncinya. Pastikan TURN_KEY_ID = Key ID dan TURN_KEY_API_TOKEN = API Token dari halaman Realtime → TURN Server (bukan API token akun).'
          : /HTTP 403/.test(d) ? 'Worker menolak situs ini. Cek ALLOWED_ORIGINS di Worker (harus https://hafidz-a.github.io).'
          : 'Worker relay belum memberi tiket. Lihat pesan di baris "Tiket relay dari Worker".';
      }
      else if (!r.direct && !r.relay) sp.textContent = 'Jaringan ini memblokir sambungan antar HP. Coba ganti jaringan.';
      else if (!r.relay) sp.textContent = 'Tiket relay ada, tapi server relay tidak bisa dihubungi dari jaringan ini. Coba jaringan lain.';
      else sp.textContent = 'Semua aman 👍';
      sp.textContent += ' Kirim screenshot ini kalau masih bermasalah.';
      tip.append(sp);
      list.append(tip);
    }
  };
  await diagnose(draw);
  $('btnCheck').disabled = false;
}
$('btnCheck').addEventListener('click', runCheck);

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

  if (rotDir && (!w || w.mode === 'pill')) S.input.a += rotDir * 3 * dt;
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
    w.clientTick(dt);
    const k = 1 - Math.exp(-dt * 18);
    for (const t of S.remoteTools.values()) {
      if (t.tx == null) continue;
      t.x += (t.tx - t.x) * k;
      t.y += (t.ty - t.y) * k;
      let da = t.ta - t.a;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      t.a += da * k;
    }
    const key = `${Math.round(S.input.x)}|${Math.round(S.input.y)}|${S.input.a.toFixed(2)}|${S.input.k}|${S.input.d}|${S.input.q}`;
    if (S.hasPointer && key !== S.lastInputKey && now - S.lastInputSent > INPUT_MS) {
      S.lastInputKey = key;
      S.lastInputSent = now;
      S.net.send({ t: 'in', x: Math.round(S.input.x), y: Math.round(S.input.y), a: +S.input.a.toFixed(3), k: S.input.k, d: S.input.d ? 1 : 0, q: S.input.q | 0 });
    }
  }

  if (playersDirty && S.mode) { renderPlayers(); playersDirty = false; }
  updateHud();
  updateInsets();

  // Build the list of hands to draw.
  const tools = [];
  if (w) {
    for (const p of S.players.values()) {
      let src;
      if (p.id === S.myId) src = S.hasPointer ? { x: S.input.x, y: S.input.y, a: S.input.a, kind: S.input.k, down: S.input.d } : null;
      else if (S.mode === 'client') src = S.remoteTools.get(p.id);
      else src = w.tools.get(p.id);
      if (!src || src.x == null || src.seen === 0) {
        // Golf shows every player's ball even before they touch the screen.
        if (w.mode !== 'golf') continue;
        src = { x: null };
      }
      tools.push({ pid: p.id, x: src.x, y: src.y, a: src.a, kind: src.kind, down: src.down, color: p.color, name: p.name, me: p.id === S.myId, bubble: S.bubbles.get(p.id) });
    }
    // Draw my own hand last so it is always on top.
    tools.sort((a, b) => (a.me ? 1 : 0) - (b.me ? 1 : 0));
  }
  S.fx = S.fx.filter((f) => now - f.t0 < 900);
  S.emotes = S.emotes.filter((e) => now - e.t0 < 1600);
  renderer.draw(w, { now, tools, fx: S.fx, emotes: S.emotes, showOwnTag: S.mode !== 'solo' });
  requestAnimationFrame(frame);
}

// Keep the table clear of the HUD, the toolbar, the player panel and the
// webcam strip, whatever size the screen is.
function updateInsets() {
  if (!S.mode) return;
  const vw = window.innerWidth, vh = window.innerHeight;
  const hud = $('hud').getBoundingClientRect();
  const bar = $('bar').getBoundingClientRect();
  let top = hud.bottom + 4, bottom = vh - bar.top + 4, left = 8, right = 8;
  const side = $('side');
  if (vw > 900 && !side.hidden) right = vw - side.getBoundingClientRect().left + 8;
  const camBox = $('cams');
  const camTop = vw > 900 ? `${Math.round(hud.bottom + 4)}px` : `${Math.round(hud.bottom + 6)}px`;
  if (camBox.style.top !== camTop) camBox.style.top = camTop;
  if (!camBox.hidden) {
    const r = camBox.getBoundingClientRect();
    if (vw > 900) left = Math.max(left, r.right + 8);
    else top = Math.max(top, r.bottom + 4);
  }
  const ins = renderer.inset;
  if (ins.top !== top || ins.bottom !== bottom || ins.left !== left || ins.right !== right) {
    renderer.inset = { top, bottom, left, right };
  }
}

function onResize() {
  renderer.resize();
}
window.addEventListener('resize', onResize);
onResize();
requestAnimationFrame(frame);

// Exposed for automated tests.
window.__pilahpil = { S, PILL_COLORS, MODES, renderer };

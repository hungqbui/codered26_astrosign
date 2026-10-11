import { Sfx } from './audio/sfx.js';
import { EFFECTS, EFFECT_KEYS } from './game/effects.js';
import {
  applyLetter, confirmSpeed, createGame, drainEvents, spawnBubble, spawnRock, update,
} from './game/engine.js';
import { FINGER_NAMES, PLAYER_COLORS, PLAYER_NAMES, PLAYER_SIDES, LETTER_STEPS } from './game/letters.js';
import { LetterClassifier } from './recognition/classifier.js';
import { GestureConfirmer } from './recognition/gestureConfirm.js';
import {
  CameraError, createLandmarker, HandTracker, loadHandModel, openCamera, WorkerHandTracker,
} from './recognition/handTracker.js';
import { compareToPose } from './recognition/poseCoach.js';
import { COLORS, drawIcon, drawSkeleton, outlinedText } from './render/draw.js';
import { Renderer } from './render/renderer.js';
import {
  ambient, countdownPop, initLogo, magnetic, resultsIn, screenIn, setReducedMotion, switchMode, tiltCards, toastIn,
} from './ui/anim.js';
import { GestureNav } from './ui/gestureNav.js';
import { initTooltips } from './ui/tooltip.js';
import { TauntDirector } from './game/taunts.js';
import './style.css';

const BASE = import.meta.env.BASE_URL;
const $ = (id) => document.getElementById(id);
const PRACTICE_PREFERRED = ['L', 'B', 'V', 'Y', 'W', 'C'];
const PRACTICE_COUNT = 4;
const AUTO_PAUSE_MS = 3500;

// ---------------- settings ----------------
const settings = (() => {
  const defaults = {
    muted: false,
    reduced: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    swap: false,
    mode: 'versus', // 'versus' | 'boss'
    shareOrbs: true, // co-op: power-ups help both players
    shareTargets: false, // co-op: either player can shoot anything (more asteroids)
  };
  try {
    // (settings saved under the game's previous name are carried over)
    const saved = localStorage.getItem('celestisign.settings') ?? localStorage.getItem('astrosign.settings');
    return { ...defaults, ...JSON.parse(saved || '{}') };
  } catch { return defaults; }
})();
function saveSettings() {
  try { localStorage.setItem('celestisign.settings', JSON.stringify(settings)); } catch { /* storage unavailable */ }
}

// ---------------- app state ----------------
const app = {
  state: 'loading',
  classifier: null,
  templates: {},
  poses: {},
  coach: null, // practice coach state (see buildCoach)
  letters: [],
  tracker: null,
  cameraOn: false,
  confirmers: [null, null],
  game: null,
  practice: null,
  countdown: null,
  ready: [false, false],
  kbFlash: [null, null],
  debug: false,
  pausedReason: null,
  bothVisibleMs: 0,
  last: performance.now(),
  t0: performance.now(),
};

const sfx = new Sfx();
sfx.setMuted(settings.muted);
const canvas = $('game');
const video = $('cam');
let renderer;
let nav; // hands-free menu navigation (see navItems)
let taunts; // THE SILENCER's lines (Gemini via /api/taunts, or built-in)

// ---------------- screens ----------------
const SCREENS = ['start', 'setup', 'error', 'tutorial', 'countdown', 'pause', 'results'];
function show(name) {
  const prev = show.current;
  show.current = name;
  for (const s of SCREENS) $(`screen-${s}`).classList.toggle('hidden', s !== name);
  if (name !== prev && nav) {
    if (name) {
      const el = $(`screen-${name}`);
      if (name === 'results') resultsIn(el);
      else if (el.querySelector('.panel')) screenIn(el);
    }
    app.confirmers.forEach((c) => c.reset()); // no pose progress carried between screens
    const items = name ? navItems(name) : [];
    if (items.length) nav.setScreen(name, items); else nav.clear();
  }
  $('btn-pause').classList.toggle('hidden', !['playing', 'tutorial'].includes(app.state));
  const coachOn = app.state === 'tutorial' || (app.state === 'paused' && app.resumeState === 'tutorial');
  $('coach').classList.toggle('hidden', !coachOn);
  const inGame = ['playing', 'tutorial', 'countdown'].includes(app.state);
  document.body.classList.toggle('in-game', inGame);
  document.body.classList.toggle('boss-mode', inGame && app.game?.mode === 'boss');
}

function setState(s, screen = s) {
  app.state = s;
  show(screen);
}

function toast(msg, ms = 2200) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  toastIn(el);
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.add('hidden'), ms);
}

// ---------------- boot ----------------
async function boot() {
  const [model, templates] = await Promise.all([
    LetterClassifier.load(`${BASE}models/asl_tfjs/model.json`),
    fetch(`${BASE}models/hand_poses.json`).then((r) => r.json()),
  ]);
  app.classifier = model;
  app.poses = templates.poses;
  app.templates = Object.fromEntries(Object.entries(app.poses).map(([L, p]) => [L, p.points]));
  app.letters = model.gameLetters;
  renderer = new Renderer(canvas, { templates: app.templates, sfx });
  renderer.setReduced(settings.reduced);
  app.confirmers = [0, 1].map(() => new GestureConfirmer(model.classes));
  window.addEventListener('resize', () => renderer.resize());
  buildPowerupLegend();
  initTooltips();
  taunts = new TauntDirector({ say: (text, live) => renderer.boss.say(text, live) });
  nav = new GestureNav({ templates: app.templates, legend: $('nav-legend') });
  setReducedMotion(settings.reduced);
  initLogo(document.querySelector('.logo'));
  magnetic();
  tiltCards($('powerups'));
  ambient();
  syncToggles();
  setState('start');
  autoStartCamera(); // hand tracking from the first screen
  requestAnimationFrame(frame);
}

function buildPowerupLegend() {
  const root = $('powerups');
  for (const k of EFFECT_KEYS) {
    const d = EFFECTS[k];
    const div = document.createElement('div');
    div.className = 'pu';
    div.dataset.effect = k;
    div.style.setProperty('--c', d.color);
    div.tabIndex = 0; // focusable, so the description tooltip also works from the keyboard
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const g = c.getContext('2d');
    g.shadowColor = d.color;
    g.shadowBlur = 12;
    g.strokeStyle = d.color;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(48, 48, 40, 0, Math.PI * 2);
    g.stroke();
    drawIcon(g, d.icon, 48, 48, 44, d.color);
    div.append(c);
    div.insertAdjacentHTML('beforeend', `<b style="color:${d.color}">${d.name}</b>`);
    root.append(div);
  }
  updatePowerupTips();
}

/** Orb descriptions (shown on hover) follow the selected mode and the shared-orbs option. */
const SHAREABLE = ['shield', 'freeze', 'haste', 'reflect', 'nova'];
function updatePowerupTips() {
  const coop = settings.mode === 'boss';
  document.querySelectorAll('.pu').forEach((el) => {
    const d = EFFECTS[el.dataset.effect];
    let text = coop ? d.coopBlurb : d.blurb;
    if (coop && settings.shareOrbs && SHAREABLE.includes(el.dataset.effect)) text += ' (both players)';
    el.dataset.tip = `${d.name}\n${text}`;
  });
}

// ---------------- camera ----------------
// The webcam + hand tracker start once and are shared by every screen. They are started
// automatically at launch (so menus are hands-free from the first screen); "Start with webcam"
// reuses the same promise and shows errors if the automatic start failed.
let trackerPromise = null;
function trackerStatus(msg) {
  $('setup-status').textContent = msg;
  nav?.setStatus(msg);
}
function ensureTracker() {
  if (app.tracker) return Promise.resolve(app.tracker);
  trackerPromise ??= (async () => {
    trackerStatus('Requesting camera permission…');
    await openCamera(video);
    // Preferred: MediaPipe in a Web Worker (never blocks rendering). Fallback: main thread.
    // ?worker=0 forces the main-thread tracker; ?delegate=GPU needs it too (WebGL lives there).
    const q = new URLSearchParams(location.search);
    const useWorker = q.get('worker') !== '0' && q.get('delegate')?.toUpperCase() !== 'GPU'
      && typeof Worker !== 'undefined' && typeof createImageBitmap === 'function';
    if (useWorker) {
      try {
        const model = await loadHandModel(trackerStatus);
        trackerStatus('Starting hand tracker…');
        app.tracker = await WorkerHandTracker.create(video, app.classifier, model);
      } catch (e) {
        console.warn('Worker hand tracking unavailable, using the main thread', e);
      }
    }
    if (!app.tracker) app.tracker = new HandTracker(video, await createLandmarker(trackerStatus), app.classifier);
    app.tracker.swapLabels = settings.swap;
    return app.tracker;
  })().catch((e) => { trackerPromise = null; throw e; });
  return trackerPromise;
}

function onTrackerReady() {
  app.cameraOn = true;
  trackerStatus('Camera ready · raise your hands');
  nav?.setStatus(null);
  $('btn-tutorial').disabled = false;
  $('btn-skip').disabled = false;
  const label = [...$('btn-start').childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim());
  if (label) label.nodeValue = 'Start';
}

async function autoStartCamera() {
  try {
    const perm = await navigator.permissions?.query({ name: 'camera' }).catch(() => null);
    if (perm?.state === 'denied') { nav.setStatus('camera blocked – use Start with webcam'); return; }
    await ensureTracker();
    onTrackerReady();
  } catch (e) {
    console.warn('automatic camera start failed', e);
    nav.setStatus('camera off – click Start with webcam');
  }
}

async function startCamera() {
  sfx.unlock();
  setState('setup');
  try {
    await ensureTracker();
    onTrackerReady();
  } catch (e) {
    console.error(e);
    showCameraError(e);
  }
}

function showCameraError(e) {
  const kind = e instanceof CameraError ? e.kind : 'model';
  const titles = {
    denied: 'Camera permission denied', notfound: 'No camera found', inuse: 'Camera is busy',
    unsupported: 'Camera not supported', model: 'Hand tracking failed to start', other: 'Camera unavailable',
  };
  const help = {
    denied: 'Click the camera icon in your browser address bar, allow access for this site, then press "Try again".',
    notfound: 'Plug in a webcam (or enable it in your system settings) and press "Try again".',
    inuse: 'Close other apps or tabs that use the camera (video calls, OBS…) and press "Try again".',
    unsupported: 'Open the game over https:// or http://localhost in a recent Chrome, Edge, Firefox or Safari.',
    model: 'The hand-tracking model could not be loaded. Check your connection / WebGL support and try again.',
    other: 'Try again, or use keyboard mode to explore the game.',
  };
  $('err-title').textContent = titles[kind] ?? titles.other;
  $('err-msg').textContent = e.message;
  $('err-help').textContent = help[kind] ?? help.other;
  setState('error');
}

// ---------------- match flow ----------------
function newGame(practice = false) {
  // Practice always uses the plain engine; matches use the chosen mode.
  const g = createGame({
    letters: app.letters,
    seed: (Math.random() * 1e9) | 0,
    mode: practice ? 'versus' : settings.mode,
    shareOrbs: settings.shareOrbs,
    shareTargets: settings.shareTargets,
  });
  app.overAt = null;
  renderer?.boss.reset();
  app.confirmers.forEach((c) => c.reset());
  if (practice) {
    g.players.forEach((p) => { p.nextSpawn = Infinity; p.nextBubble = Infinity; });
    const pool = PRACTICE_PREFERRED.filter((L) => app.letters.includes(L));
    for (const L of app.letters) if (!pool.includes(L)) pool.push(L);
    app.practice = { letters: pool.slice(0, PRACTICE_COUNT), done: [0, 0], finishedAt: null };
    for (const side of [0, 1]) spawnPractice(g, side);
  } else {
    app.practice = null;
  }
  renderer?.fx.clear();
  renderer?.orb.clear();
  return g;
}

function spawnPractice(g, side) {
  const i = app.practice.done[side];
  if (i >= app.practice.letters.length) return;
  const o = spawnRock(g, side, { letters: [app.practice.letters[i]] });
  o.speed = 0;
  o.x = side === 0 ? 0.72 : 0.28; // leave the outer half of each side for the pose coach
  o.y = 0.4;
}

function startTutorial() {
  sfx.unlock();
  app.game = newGame(true);
  setState('tutorial');
  updateTutorialBanner();
  buildCoach();
}

// ---------------- practice coach ----------------
// Per player: step-by-step instructions, a three.js view of the target pose with the player's
// own tracked hand overlaid (fingers coloured green / amber / red), a match meter from the
// classifier, and plain-language feedback.
async function buildCoach() {
  if (app.coach) { app.coach.sides.forEach((c) => { c.letter = null; }); return; }
  const root = $('coach');
  const sides = [0, 1].map((side) => {
    const el = document.createElement('div');
    el.className = `coach p${side + 1}`;
    el.innerHTML = `
      <div class="coach-head"><div class="coach-letter">?</div>
        <div><div class="coach-title">${PLAYER_NAMES[side]} · ${PLAYER_SIDES[side]}</div><ol class="coach-steps"></ol></div></div>
      <div class="coach-3d"><canvas aria-label="3-D hand pose guide"></canvas>
        <div class="coach-legend"><i>ghost</i> = target · <i>colour</i> = your hand · drag to rotate</div></div>
      <div class="coach-match"><span>Match</span><div class="bar"><i></i></div><span class="pct">–</span></div>
      <div class="coach-feedback"></div>`;
    root.append(el);
    return { el, letter: null, match: 0, viewer: null, successAt: 0 };
  });
  app.coach = { sides, ready: false };
  try {
    const { HandViewer3D } = await import('./render/handViewer3d.js');
    sides.forEach((c, side) => {
      c.viewer = new HandViewer3D(c.el.querySelector('canvas'), { color: PLAYER_COLORS[side], hand: 'right' });
    });
  } catch (e) {
    console.warn('3-D pose view unavailable', e);
    sides.forEach((c) => { c.el.querySelector('.coach-3d').innerHTML = '<div class="coach-fallback">3-D view needs WebGL. Follow the steps above and the diagram below.</div>'; });
  }
  app.coach.ready = true;
}

function updateCoach(hands, t) {
  const coach = app.coach;
  const p = app.practice;
  if (!coach?.ready || !p) return;
  coach.sides.forEach((c, side) => {
    const done = p.done[side] >= p.letters.length;
    const L = done ? null : p.letters[p.done[side]];
    if (L !== c.letter) {
      c.letter = L;
      c.match = 0;
      c.el.querySelector('.coach-letter').textContent = L ?? '✓';
      c.el.querySelector('.coach-steps').innerHTML = L
        ? LETTER_STEPS[L].map((s) => `<li>${s}</li>`).join('')
        : '<li>All done! Waiting for the other player…</li>';
      if (L && c.viewer) c.viewer.setPose(app.poses[L]);
    }
    c.el.classList.toggle('success', performance.now() - c.successAt < 700);
    // Show the pose for the hand this player is actually using.
    const usedHand = hands[side]?.hand ?? c.hand ?? 'right';
    if (usedHand !== c.hand) {
      c.hand = usedHand;
      c.viewer?.setHand(usedHand);
      c.el.querySelector('.coach-title').textContent = `${PLAYER_NAMES[side]} · ${PLAYER_SIDES[side]} · ${usedHand} hand`;
    }
    const fb = c.el.querySelector('.coach-feedback');
    const hand = hands[side];
    let msg = '';
    if (!L) {
      msg = '<span class="ok">Practice complete</span>';
      c.viewer?.setLive(null);
    } else if (!app.cameraOn) {
      msg = `Keyboard mode: press <b>${side === 0 ? L.toLowerCase() : `Shift+${L.toLowerCase()}`}</b>`;
      c.viewer?.setLive(null);
    } else if (!hand) {
      msg = `<span class="bad">Raise your hand on the ${PLAYER_SIDES[side]} of the camera</span>`;
      c.viewer?.setLive(null);
      c.match *= 0.9;
    } else {
      const cmp = compareToPose(hand.points, app.poses[L]);
      c.viewer?.setLive(cmp.normalised, cmp.status);
      const prob = hand.probs[app.classifier.classes.indexOf(L)] ?? 0;
      c.match += 0.25 * (prob - c.match);
      const off = FINGER_NAMES.filter((_, i) => cmp.status[i] === 'off');
      const close = FINGER_NAMES.filter((_, i) => cmp.status[i] === 'close');
      if (c.match > 0.6) msg = '<span class="ok">That\'s it! Hold steady…</span>';
      else if (off.length) msg = `<span class="bad">Adjust: ${off.join(', ')}</span>${close.length ? ` <span class="warn">· nearly: ${close.join(', ')}</span>` : ''}`;
      else if (close.length) msg = `<span class="warn">Nearly – check ${close.join(', ')}</span>`;
      else msg = '<span class="warn">Fingers look right – turn your hand to match the ghost</span>';
    }
    fb.innerHTML = msg;
    const pct = Math.round(Math.max(0, Math.min(1, c.match)) * 100);
    c.el.querySelector('.coach-match i').style.width = `${pct}%`;
    c.el.querySelector('.coach-match .pct').textContent = app.cameraOn && L ? `${pct}%` : '–';
    // ~30 fps is plenty for the guide and keeps the shared WebGL context light.
    if (c.viewer && t - (c.lastRender ?? 0) > 1 / 30) {
      c.lastRender = t;
      c.viewer.render(t, settings.reduced);
      if (!c.viewer.ok) {
        console.warn('3-D pose view lost its WebGL context; falling back to 2-D guide');
        c.viewer = null;
        c.el.querySelector('.coach-3d').innerHTML = '<div class="coach-fallback">3-D view unavailable (WebGL context lost). Follow the steps above and the diagram below.</div>';
      }
    }
  });
}

function updateTutorialBanner() {
  const p = app.practice;
  if (!p) return;
  const n = p.letters.length;
  $('tut-progress').innerHTML = `<span class="p1">P1 ${p.done[0]}/${n}</span>&ensp;<span class="p2">P2 ${p.done[1]}/${n}</span>`;
}

function startCountdown() {
  sfx.unlock();
  app.game = newGame(false);
  if (app.game.mode === 'boss') taunts.prepare(app.game); // fetch Gemini lines during the countdown
  app.countdown = { t: 0, shown: null };
  setState('countdown');
}

function startPlaying() {
  setState('playing', null);
  app.pausedReason = null;
  if (app.game?.mode === 'boss') taunts.start(app.game);
}

function pause(reason = null) {
  if (!['playing', 'tutorial'].includes(app.state)) return;
  app.resumeState = app.state;
  app.pausedReason = reason;
  $('pause-title').textContent = reason === 'hands' ? 'Hands lost' : 'Paused';
  $('pause-msg').textContent = reason === 'hands'
    ? 'Both players: raise your playing hand to resume automatically.'
    : '';
  setState('paused', 'pause');
}

function resume() {
  if (app.state !== 'paused') return;
  const s = app.resumeState ?? 'playing';
  app.pausedReason = null;
  app.bothVisibleMs = 0;
  setState(s, s === 'tutorial' ? 'tutorial' : null);
  app.last = performance.now();
}

function toMenu() {
  if (app.tracker) app.cameraOn = true; // back from keyboard mode: hands drive the menus again
  app.game = null;
  app.practice = null;
  setState('start');
}

function finish() {
  const g = app.game;
  setState('results');
  const w = g.winner;
  const el = $('winner');
  if (g.mode === 'boss') return finishBoss(g, el);
  el.textContent = w === 'draw' ? 'DRAW!' : `${PLAYER_NAMES[w].toUpperCase()} WINS!`;
  el.style.setProperty('--wc', w === 'draw' ? '#c79bff' : PLAYER_COLORS[w]);
  for (const side of [0, 1]) {
    const p = g.players[side];
    const attempts = p.hits + p.misses;
    const rows = [
      ['Score', p.score.toLocaleString()],
      ['Asteroids destroyed', p.destroyed],
      ['Bubbles cleared', p.bubbles],
      ['Letters signed', p.hits],
      ['Accuracy', attempts ? `${Math.round((p.hits / attempts) * 100)}%` : '–'],
      ['Best combo', p.maxCombo],
      ['Hits taken', p.impacts],
      ['Health left', Math.ceil(p.health)],
    ];
    $(`stats-p${side + 1}`).innerHTML = `<h3>${PLAYER_NAMES[side]}${w === side ? ' <span class="badge">WINNER</span>' : ''}</h3><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl><div class="ready" id="ready-${side}"></div>`;
  }
  $('rematch-hint').innerHTML = app.cameraOn
    ? 'Both players: hold <b>B</b> for a rematch, or press <kbd>Enter</kbd>'
    : 'Press <kbd>Enter</kbd> for a rematch';
  sfx.win();
}

function finishBoss(g, el) {
  const won = g.winner === 'team';
  el.textContent = won ? 'VICTORY!' : 'DEFEATED';
  el.style.setProperty('--wc', won ? COLORS.accent : COLORS.danger);
  const dmg = g.boss.damageBy;
  const mvp = dmg[0] === dmg[1] ? -1 : dmg[0] > dmg[1] ? 0 : 1;
  const mm = Math.floor(g.t / 60);
  const ss = Math.floor(g.t % 60).toString().padStart(2, '0');
  for (const side of [0, 1]) {
    const p = g.players[side];
    const attempts = p.hits + p.misses;
    const rows = [
      ['Boss damage', `${dmg[side]} (${Math.round((dmg[side] / Math.max(1, dmg[0] + dmg[1])) * 100)}%)`],
      ['Score', p.score.toLocaleString()],
      ['Asteroids destroyed', p.destroyed],
      ['Orbs cleared', p.bubbles],
      ['Letters signed', p.hits],
      ['Accuracy', attempts ? `${Math.round((p.hits / attempts) * 100)}%` : '–'],
      ['Best combo', p.maxCombo],
      ['Hits taken', p.impacts],
    ];
    $(`stats-p${side + 1}`).innerHTML = `<h3>${PLAYER_NAMES[side]}${mvp === side ? ' <span class="badge">MVP</span>' : ''}</h3><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl><div class="ready" id="ready-${side}"></div>`;
  }
  $('rematch-hint').innerHTML = `${won ? 'Boss defeated' : `Boss had ${g.boss.hp} HP left`} in ${mm}:${ss} · phase ${g.boss.phase + 1}/3. `
    + (app.cameraOn ? 'Both hold <b>B</b> to try again, or press <kbd>Enter</kbd>' : 'Press <kbd>Enter</kbd> to try again');
  if (won) sfx.win(); else sfx.bossRoar();
}

// ---------------- input ----------------
function onLetter(side, letter, fromKeyboard = false) {
  const s = app.state;
  if (s === 'playing' || s === 'tutorial') {
    sfx.confirm(side === 0 ? -0.6 : 0.6);
    applyLetter(app.game, side, letter);
  } else if (!fromKeyboard && nav?.confirm(side, letter)) {
    sfx.confirm(side === 0 ? -0.6 : 0.6); // a menu action (hands-free navigation)
  }
}

// ---------------- hands-free navigation mapping ----------------
// One consistent vocabulary across menus:
//   B (flat hand) = confirm / go      L = leave (back / main menu)      Y = skip / restart
//   V / C = Versus / Co-op            O / X = toggle shared orbs / shared targets
//   K = keyboard mode (camera error screen)
function navItems(screen) {
  const coop = () => settings.mode === 'boss';
  switch (screen) {
    case 'start': return [
      { letter: 'B', target: $('btn-start'), label: 'Start', action: () => $('btn-start').click() },
      { letter: 'V', target: document.querySelector('.mode-btn[data-mode="versus"]'), label: 'Versus', action: () => setMode('versus') },
      { letter: 'C', target: document.querySelector('.mode-btn[data-mode="boss"]'), label: 'Co-op boss', action: () => setMode('boss') },
      { letter: 'O', target: $('opt-share-orbs').closest('.opt'), label: 'Shared power-ups', visible: coop, action: () => $('opt-share-orbs').click() },
      { letter: 'X', target: $('opt-share-targets').closest('.opt'), label: 'Shared targets', visible: coop, action: () => $('opt-share-targets').click() },
    ];
    case 'setup': return [
      { letter: 'B', target: $('btn-tutorial'), label: 'Practice', both: true, action: () => startTutorial() },
      { letter: 'Y', target: $('btn-skip'), label: 'Skip to game', action: () => startCountdown() },
      { letter: 'L', target: $('btn-back1'), label: 'Back', action: () => toMenu() },
    ];
    case 'error': return [
      { letter: 'B', target: $('btn-retry'), label: 'Try again', action: () => startCamera() },
      { letter: 'K', target: $('btn-err-keyboard'), label: 'Keyboard', action: () => $('btn-err-keyboard').click() },
      { letter: 'L', target: $('btn-back2'), label: 'Back', action: () => toMenu() },
    ];
    case 'pause': return [
      { letter: 'B', target: $('btn-resume'), label: 'Resume', action: () => resume() },
      { letter: 'Y', target: $('btn-restart'), label: 'Restart', action: () => startCountdown() },
      { letter: 'L', target: $('btn-menu'), label: 'Main menu', action: () => toMenu() },
    ];
    case 'results': return [
      { letter: 'B', target: $('btn-rematch'), label: 'Rematch', both: true, action: () => startCountdown() },
      { letter: 'L', target: $('btn-menu2'), label: 'Main menu', action: () => toMenu() },
    ];
    default: return [];
  }
}

function setMode(mode) {
  if (mode === settings.mode) return;
  settings.mode = mode;
  saveSettings();
  syncMode(true);
  nav?.renderLegend();
}

window.addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target instanceof HTMLInputElement) return;
  const st = app.state;
  if (e.key === 'Escape') {
    if (st === 'paused') resume();
    else pause();
    e.preventDefault();
    return;
  }
  if (e.key === 'Enter') {
    if (st === 'start') { e.preventDefault(); $('btn-start').click(); }
    else if (st === 'results') { e.preventDefault(); startCountdown(); }
    else if (st === 'paused') { e.preventDefault(); resume(); }
    return;
  }
  if (e.code === 'Backquote') {
    app.debug = !app.debug;
    $('debug').classList.toggle('hidden', !app.debug);
    return;
  }
  const g = app.game;
  if (/^Digit[1-9]$/.test(e.code) && g && st === 'playing' && Number(e.code.slice(5)) <= EFFECT_KEYS.length) {
    spawnBubble(g, e.shiftKey ? 1 : 0, EFFECT_KEYS[Number(e.code.slice(5)) - 1]);
    return;
  }
  if (e.code === 'Digit0' && g && st === 'playing') {
    g.startLevel = Math.min(12, g.startLevel + 1);
    toast(`Level ${g.startLevel + Math.floor(g.t / 22)}`);
    return;
  }
  if (/^Key[A-Z]$/.test(e.code)) {
    const L = e.code.slice(3);
    const side = e.shiftKey ? 1 : 0;
    if (!app.classifier.classes.includes(L)) return;
    if (st === 'playing' || st === 'tutorial') {
      app.kbFlash[side] = { letter: L, t: performance.now() };
      onLetter(side, L, true);
      e.preventDefault();
    }
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

// ---------------- buttons ----------------
$('btn-start').onclick = () => { sfx.click(); startCamera(); };
$('btn-keyboard').onclick = () => { sfx.unlock(); sfx.click(); app.cameraOn = false; startTutorialOrGame(); };
$('btn-err-keyboard').onclick = () => { sfx.click(); app.cameraOn = false; startTutorialOrGame(); };
$('btn-retry').onclick = () => { sfx.click(); startCamera(); };
$('btn-back1').onclick = $('btn-back2').onclick = () => { sfx.click(); toMenu(); };
$('btn-tutorial').onclick = () => { sfx.click(); startTutorial(); };
$('btn-skip').onclick = () => { sfx.click(); startCountdown(); };
$('btn-tut-skip').onclick = () => { sfx.click(); startCountdown(); };
$('btn-resume').onclick = () => { sfx.click(); resume(); };
$('btn-restart').onclick = () => { sfx.click(); startCountdown(); };
$('btn-menu').onclick = $('btn-menu2').onclick = () => { sfx.click(); toMenu(); };
$('btn-rematch').onclick = () => { sfx.click(); startCountdown(); };
$('btn-pause').onclick = () => { if (app.state === 'paused') resume(); else pause(); };
$('btn-mute').onclick = () => { settings.muted = !settings.muted; sfx.unlock(); sfx.setMuted(settings.muted); saveSettings(); syncToggles(); };
$('btn-motion').onclick = () => { settings.reduced = !settings.reduced; renderer.setReduced(settings.reduced); setReducedMotion(settings.reduced); saveSettings(); syncToggles(); };
$('chk-swap').onchange = (e) => {
  settings.swap = e.target.checked;
  if (app.tracker) app.tracker.swapLabels = settings.swap;
  saveSettings();
};

function startTutorialOrGame() {
  toast('Keyboard mode: letters = Player 1, Shift+letter = Player 2', 3500);
  startTutorial();
}

function syncMode(animate = false) {
  document.querySelectorAll('.mode-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === settings.mode)));
  switchMode(settings.mode, !animate);
  updatePowerupTips();
  $('opt-share-orbs').checked = settings.shareOrbs;
  $('opt-share-targets').checked = settings.shareTargets;
}
$('opt-share-orbs').onchange = (e) => { settings.shareOrbs = e.target.checked; saveSettings(); updatePowerupTips(); };
$('opt-share-targets').onchange = (e) => { settings.shareTargets = e.target.checked; saveSettings(); };
document.querySelectorAll('.mode-btn').forEach((b) => {
  b.onclick = () => { setMode(b.dataset.mode); sfx.unlock(); sfx.click(); };
});

function syncToggles() {
  syncMode();
  $('btn-mute').innerHTML = settings.muted
    ? '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4zM17 8.5a5 5 0 0 1 0 7M19.5 6a8.5 8.5 0 0 1 0 12"/></svg>';
  $('btn-mute').setAttribute('aria-pressed', String(settings.muted));
  $('btn-mute').title = settings.muted ? 'Unmute sound' : 'Mute sound';
  $('btn-motion').setAttribute('aria-pressed', String(settings.reduced));
  $('btn-motion').title = settings.reduced ? 'Reduced motion: ON' : 'Reduced motion: OFF';
  $('chk-swap').checked = settings.swap;
}

// ---------------- main loop ----------------
// Rolling per-stage timings (ms), shown in the debug overlay.
app.perf = {};
function perf(key, ms) {
  const p = (app.perf[key] ??= { avg: ms, max: ms });
  p.avg += 0.05 * (ms - p.avg);
  p.max = Math.max(ms, p.max * 0.995);
}

function frame(now) {
  requestAnimationFrame(frame);
  // Gesture holds use real elapsed time (so slow machines still confirm on schedule); the
  // simulation step is capped to avoid huge jumps after a stall or tab switch.
  const realMs = Math.min(200, Math.max(0, now - app.last));
  app.last = now;
  const dt = Math.min(50, realMs) / 1000;
  app.renderFps = app.renderFps ? app.renderFps * 0.95 + (1000 / Math.max(1, realMs)) * 0.05 : 60;
  const st = app.state;
  const g = app.game;

  // 1) hand tracking + gesture confirmation
  let hands = [null, null];
  let missing = [0, 0];
  if (app.cameraOn && app.tracker) {
    const t0 = performance.now();
    try { app.tracker.tick(now); } catch (e) { console.error(e); }
    perf('track', performance.now() - t0);
    hands = app.tracker.players;
    const sig = hands.map((h) => (h ? `${h.handedness}->${h.hand}@${h.screen.x < 0.5 ? 'L' : 'R'}` : '-')).join(' | ');
    if (sig !== app.lastHandSig && (now - (app.lastHandLog ?? 0)) > 1000) {
      app.lastHandSig = sig;
      app.lastHandLog = now;
      // warn level so the Vite dev server forwards it to its terminal log (it drops info/log)
      if (import.meta.env.DEV) console.warn(`[hands] P1: ${sig.split(' | ')[0]}  P2: ${sig.split(' | ')[1]}  (MediaPipe label -> hand @ screen side; swap=${settings.swap})`);
    }
    missing = app.tracker.missingFor(now);
    const active = st === 'playing' || st === 'tutorial';
    for (const side of [0, 1]) {
      const speed = active && g ? confirmSpeed(g, side) : 1;
      const allowed = active ? app.letters : nav?.screen ? nav.letters : null;
      const L = app.confirmers[side].update(hands[side]?.probs ?? null, realMs, { speed, allowed });
      if (L) onLetter(side, L);
    }
  }

  // 2) simulation
  if (st === 'playing' && g) {
    update(g, dt * renderer.timeScale()); // brief hit-stop when an orb breaks
    if (app.cameraOn) {
      // Auto-pause if a player's hand has been gone for a while (camera covered, player left…).
      if (Math.max(...missing) > AUTO_PAUSE_MS) pause('hands');
    }
  } else if (st === 'tutorial' && g) {
    update(g, dt * renderer.timeScale());
  } else if (st === 'paused' && app.pausedReason === 'hands') {
    app.bothVisibleMs = hands[0] && hands[1] ? app.bothVisibleMs + realMs : 0;
    if (app.bothVisibleMs > 600) resume();
  } else if (st === 'countdown') {
    tickCountdown(dt);
  }

  if (g) {
    let events = drainEvents(g);
    if (app.practice) events = events.filter((e) => e.type !== 'levelUp');
    renderer.handleEvents(events, g);
    if (g.mode === 'boss' && (st === 'playing' || g.over)) taunts.onEvents(events, g);
    if (app.practice && st === 'tutorial') tickPractice(events, g);
    if (g.over && st === 'playing') {
      // Let the final moment play out (boss explosion / last impact) before the results.
      app.overAt ??= now;
      if (now - app.overAt > (g.mode === 'boss' ? 2800 : 900)) finish();
    }
  }

  // 3) render
  const tr = performance.now();
  renderer.monitor(realMs);
  const confirm = app.confirmers.map((c, side) => {
    const kb = app.kbFlash[side];
    if (kb && now - kb.t < 350) {
      return { candidate: kb.letter, progress: 1, needsRelease: true, display: { letter: kb.letter, confidence: 1 } };
    }
    return app.cameraOn ? c.state : null;
  });
  const showGame = ['playing', 'tutorial', 'paused', 'countdown', 'results'].includes(st) && g;
  renderer.draw({
    t: (now - app.t0) / 1000,
    dt,
    game: showGame ? g : null,
    confirm,
    hands,
    missing,
    cameraOn: app.cameraOn,
    video: app.cameraOn && showGame ? (app.tracker?.frame ?? video) : null, // preview only in game screens
    practice: !!app.practice,
    camAspect: video.videoWidth ? video.videoWidth / video.videoHeight : 16 / 9,
    labels: true,
  });

  if (nav?.screen) {
    nav.setEnabled(app.cameraOn);
    document.body.classList.toggle('nav-on', app.cameraOn);
    nav.update(app.cameraOn ? app.confirmers.map((c) => c.state) : [null, null]);
  }
  if (st === 'setup') drawSetup(hands);
  if (st === 'tutorial') updateCoach(hands, (now - app.t0) / 1000);
  if (st === 'results' && app.cameraOn) {
    for (const side of [0, 1]) {
      const el = $(`ready-${side}`);
      if (el) el.textContent = nav.ready[side] ? '✓ ready for rematch' : '';
    }
  }
  perf('render', performance.now() - tr);
  perf('frame', performance.now() - now);
  if (app.debug) drawDebug(hands, now);
}

function tickPractice(events, g) {
  const p = app.practice;
  for (const e of events) {
    if (e.type === 'destroy') {
      if (app.coach) app.coach.sides[e.side].successAt = performance.now();
      p.done[e.side]++;
      if (p.done[e.side] < p.letters.length) spawnPractice(g, e.side);
      updateTutorialBanner();
    }
  }
  const finished = p.done.every((d) => d >= p.letters.length);
  if (finished && p.finishedAt === null) {
    p.finishedAt = g.t;
    toast('Nice signing! Get ready…', 1500);
  }
  if (p.finishedAt !== null && g.t - p.finishedAt > 1.3) startCountdown();
}

function tickCountdown(dt) {
  const c = app.countdown;
  c.t += dt;
  const steps = ['3', '2', '1', 'GO!'];
  const i = Math.min(steps.length - 1, Math.floor(c.t / 0.85));
  if (c.shown !== i) {
    c.shown = i;
    const el = $('count');
    el.textContent = steps[i];
    el.classList.toggle('go', i === steps.length - 1);
    countdownPop(el);
    sfx.countdown(i === steps.length - 1);
  }
  if (c.t >= 0.85 * steps.length - 0.3) startPlaying();
}

// Setup screen: big mirrored camera view with player overlays.
const setupCanvas = $('setup-canvas');
function drawSetup(hands) {
  const ctx = setupCanvas.getContext('2d');
  const w = setupCanvas.clientWidth;
  const h = setupCanvas.clientHeight;
  if (!w || !h) return;
  if (setupCanvas.width !== w || setupCanvas.height !== h) { setupCanvas.width = w; setupCanvas.height = h; }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  // Draw the tracker's frame snapshot (the exact image the landmarks came from).
  const src = app.tracker?.frame ?? video;
  const VW = src.videoWidth ?? src.width;
  const VH = src.videoHeight ?? src.height;
  if (!app.cameraOn || !VW || !VH) return;
  const va = VW / VH;
  let sw = VW;
  let sh = VH;
  let sx = 0;
  let sy = 0;
  if (va > w / h) { sw = sh * (w / h); sx = (VW - sw) / 2; } else { sh = sw / (w / h); sy = (VH - sh) / 2; }
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  ctx.restore();
  ctx.fillStyle = 'rgba(56,225,255,0.06)';
  ctx.fillRect(0, 0, w / 2, h);
  ctx.fillStyle = 'rgba(255,79,216,0.06)';
  ctx.fillRect(w / 2, 0, w / 2, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
  ctx.setLineDash([]);
  outlinedText(ctx, 'P1 · LEFT SIDE', 14, h - 16, { size: 15, color: PLAYER_COLORS[0], align: 'left' });
  outlinedText(ctx, 'P2 · RIGHT SIDE', w - 14, h - 16, { size: 15, color: PLAYER_COLORS[1], align: 'right' });
  const map = (p) => [w - ((p.x * VW - sx) / sw) * w, ((p.y * VH - sy) / sh) * h];
  for (const side of [0, 1]) {
    const hd = hands[side];
    const card = $(`setup-p${side + 1}`);
    const c = app.confirmers[side].state;
    card.classList.toggle('ok', !!hd);
    let label = 'waiting…';
    if (hd) {
      const L = c.display.letter;
      label = nav.ready[side] ? '✓ ready' : `✓ tracked · ${L ?? '?'} ${Math.round(c.display.confidence * 100)}%`;
    }
    card.querySelector('em').textContent = label;
    if (!hd) continue;
    const pts = hd.landmarks.map(map);
    drawSkeleton(ctx, pts, PLAYER_COLORS[side], { width: 3 });
    // Show which hand was detected (pose hints follow it), and which player it belongs to.
    const tag = `P${side + 1} · ${hd.hand.toUpperCase()} hand`;
    outlinedText(ctx, tag, pts[12][0], Math.max(16, Math.min(...pts.map((q) => q[1])) - 16), {
      size: 14, color: PLAYER_COLORS[side], font: 'Inter, sans-serif', weight: 800,
    });
    const L = c.display.letter;
    if (L) {
      outlinedText(ctx, L, pts[0][0], Math.min(h - 30, pts[0][1] + 40), { size: 40, color: c.display.confidence >= 0.6 ? '#fff' : 'rgba(255,255,255,0.5)' });
    }
    if (c.candidate === 'B' && !nav.ready[side]) {
      ctx.save();
      ctx.strokeStyle = PLAYER_COLORS[side];
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(pts[9][0], pts[9][1], 50, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * c.progress);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawDebug(hands, now) {
  const pf = Object.entries(app.perf).map(([k, v]) => `${k} ${v.avg.toFixed(1)}ms (max ${v.max.toFixed(0)})`).join(' · ');
  const lines = [pf, `state=${app.state} render=${(app.renderFps ?? 0).toFixed(0)}fps tracking=${app.tracker ? `${app.tracker.fps.toFixed(0)}fps (${app.tracker.delegate}, detect ${(app.tracker.detectMs ?? 0).toFixed(0)}ms)` : '-'} letters=${app.letters.join('')}`];
  for (const side of [0, 1]) {
    const hd = hands[side];
    const c = app.confirmers[side].state;
    if (!hd) { lines.push(`P${side + 1}: no hand (missing ${(app.tracker?.missingFor(now)[side] ?? 0).toFixed(0)}ms)`); continue; }
    const top = [...hd.probs].map((p, i) => [app.classifier.classes[i], p]).sort((a, b) => b[1] - a[1]).slice(0, 3);
    lines.push(`P${side + 1}: ${hd.hand} (mp=${hd.handedness} ${hd.handScore.toFixed(2)}) top ${top.map(([l, p]) => `${l}:${p.toFixed(2)}`).join(' ')}`);
    lines.push(`    cand=${c.candidate ?? '-'} prog=${c.progress.toFixed(2)} lock=${c.locked ?? '-'} ema=${c.display.letter}:${c.display.confidence.toFixed(2)}`);
  }
  if (app.game) {
    const g = app.game;
    lines.push(`t=${g.t.toFixed(1)} level=${g.level} objects=${g.objects.length} hp=${g.players.map((p) => p.health).join('/')}`);
  }
  $('debug').textContent = lines.join('\n');
}

window.addEventListener('error', (e) => console.error('[uncaught]', e.message, e.filename, e.lineno));
window.addEventListener('unhandledrejection', (e) => console.error('[unhandled rejection]', e.reason?.message ?? e.reason));

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<div class="screen"><div class="panel narrow"><h2>Failed to load</h2><p>${e.message}</p></div></div>`);
});

// Exposed for automated browser tests (dev server only).
if (import.meta.env.DEV) window.__app = app;

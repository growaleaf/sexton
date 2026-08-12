// game.js — DOM, input, WebAudio, and the screen state machine for SEXTON.
// The pure rules live in bells.mjs; this file only ever calls them, never
// reimplements them.
import {
  rounds, plainHuntRows, ringDoublesLead, ringTouch, applyPlaceNotation, CALL_TOKENS,
  trebleAction, checkPlayerAction, generateVillageYears,
  encodeSave, decodeSave,
} from './bells.mjs';

const STORAGE_KEY = 'sexton_v1';
const HOST = location.hostname ? `http://${location.hostname}/` : 'http://sexton.defimagic.io/';

function loadSave() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error('empty');
    return decodeSave(raw, atob);
  } catch (e) {
    return { seed: Math.floor(Math.random() * 1e9), unlocked: { n3: false, n4: false, n5: false, doubles: false }, completedYears: [] };
  }
}
function persist() {
  try { localStorage.setItem(STORAGE_KEY, encodeSave(state.save, btoa)); } catch (e) { /* storage unavailable — play on without it */ }
}

// --- WebAudio: synthesized bell tones, no external assets ---
const BELL_FREQS = [0, 880, 784, 698.46, 659.25, 587.33]; // index by bell number, 1..5, treble highest
let actx = null;
function audioCtx() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  return actx;
}
function playBell(bellNumber) {
  try {
    const ctx = audioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    const freq = BELL_FREQS[bellNumber] || 440;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.28, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t0);
    osc.connect(gain);
    osc.start(t0); osc.stop(t0 + 0.95);
    const partial = ctx.createOscillator();
    const pg = ctx.createGain();
    pg.gain.setValueAtTime(0.0001, t0);
    pg.gain.exponentialRampToValueAtTime(0.09, t0 + 0.008);
    pg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    partial.type = 'sine';
    partial.frequency.setValueAtTime(freq * 2.42, t0);
    partial.connect(pg); pg.connect(ctx.destination);
    partial.start(t0); partial.stop(t0 + 0.55);
  } catch (e) { /* audio unavailable — the ringing carries on in silence */ }
}

// --- state ---
const state = {
  screen: 'title',
  save: loadSave(),
  practice: null,
  doubles: null,
  village: null,
  activeYear: null,
  lastShare: null,
  msg: '',
  msgKind: '',
  pulse: {}, // bellNumber -> timestamp of last strike, for the swing animation
};

function newPracticeRound(n) {
  const rows = plainHuntRows(n, n * 2);
  state.practice = { n, rows, stepIndex: 0 };
}
function newDoublesTutorial() {
  state.doubles = {
    calls: ['bob', 'bob'],
    leadIndex: 0,
    rowsAll: [rounds(5)],
    stepIndex: 0,
    revealed: false,
    revealDone: false,
  };
}
function startYear(index) {
  const y = state.village.years[index];
  state.activeYear = { index, year: y, rowsAll: [rounds(5)], stepIndex: 0, leadIndex: 0 };
  state.screen = 'ring';
}

// --- animation loop (cosmetic only; game logic never depends on RAF) ---
// `step` is the pure(ish) tick body — callable directly with an injected
// time for verification, and safe to call from a real timer. There is no
// continuous requestAnimationFrame loop: this is a turn-based game, and a
// per-frame render() would tear down and rebuild the DOM 60x/second,
// permanently resetting the CSS entrance animation before it ever
// finished (caught by screenshot review — the title screen painted fully
// transparent because `.screen` was recreated mid-fade on every frame).
function step(now) {
  let changed = false;
  for (const b of Object.keys(state.pulse)) {
    if (now - state.pulse[b] > 500) { delete state.pulse[b]; changed = true; }
  }
  return changed;
}

function strike(bellNumber) {
  playBell(bellNumber);
  state.pulse[bellNumber] = performance.now();
  setTimeout(() => { if (step(performance.now())) render(); }, 520);
}

function setMsg(text, kind) { state.msg = text; state.msgKind = kind || ''; }

// --- PRACTICE screen logic ---
function practiceTap(action) {
  const p = state.practice;
  const rows = p.rows;
  if (checkPlayerAction(rows, p.stepIndex, action)) {
    p.stepIndex += 1;
    strike(1);
    setMsg('', '');
    if (p.stepIndex >= rows.length - 1) {
      const n = p.n;
      if (n === 3) state.save.unlocked.n3 = true;
      if (n === 4) state.save.unlocked.n4 = true;
      if (n === 5) state.save.unlocked.n5 = true;
      persist();
      setMsg('Rounds again. That is a plain course of Plain Hunt — you came all the way round.', 'good');
    }
  } else {
    setMsg('You hunted past your place — feel where your bell sits, then try again.', 'bad');
  }
  render();
}

// --- DOUBLES screen logic ---
function doublesTap(action) {
  const d = state.doubles;
  if (d.stepIndex === 9 && !d.revealed && !d.revealDone) {
    // lead-end reveal moment, first time only — show all three call outcomes
    // before letting the tap through.
    d.revealed = true;
    render();
    return;
  }
  const call = d.calls[d.leadIndex];
  const fullLead = ringDoublesLead(leadStartRow(d), call);
  const within = [leadStartRow(d), ...fullLead];
  if (checkPlayerAction(within, d.stepIndex, action)) {
    d.stepIndex += 1;
    strike(1);
    d.rowsAll.push(within[d.stepIndex]);
    setMsg('', '');
    if (d.stepIndex >= 10) {
      d.leadIndex += 1;
      d.stepIndex = 0;
      d.revealed = false;
      if (d.leadIndex >= d.calls.length) {
        state.save.unlocked.doubles = true;
        persist();
        setMsg('Come round! You rang your first touch of Plain Bob Doubles.', 'good');
      }
    }
  } else {
    setMsg('You hunted past your place — the lead end does not change what YOU do. Try again.', 'bad');
  }
  render();
}
function leadStartRow(d) {
  // rowsAll holds every row rung so far across leads; the lead start is the
  // row before this lead's own progress.
  return d.rowsAll[d.rowsAll.length - 1 - d.stepIndex];
}
function doublesConfirmReveal() {
  const d = state.doubles;
  d.revealed = false;
  d.revealDone = true;
  render();
}

// --- village ring screen logic (shared shape with doubles, but driven by a precomposed touch) ---
function ringTap(action) {
  const r = state.activeYear;
  const call = r.year.calls[r.leadIndex];
  const leadStart = r.rowsAll[r.rowsAll.length - 1 - r.stepIndex];
  const fullLead = ringDoublesLead(leadStart, call);
  const within = [leadStart, ...fullLead];
  if (checkPlayerAction(within, r.stepIndex, action)) {
    r.stepIndex += 1;
    strike(1);
    r.rowsAll.push(within[r.stepIndex]);
    setMsg('', '');
    if (r.stepIndex >= 10) {
      r.leadIndex += 1;
      r.stepIndex = 0;
      if (r.leadIndex >= r.year.calls.length) {
        completeYear();
        return;
      }
    }
  } else {
    setMsg('You hunted past your place — try again.', 'bad');
  }
  render();
}
function completeYear() {
  const r = state.activeYear;
  const result = ringTouch(r.year.calls);
  if (!state.save.completedYears.includes(r.index)) {
    state.save.completedYears.push(r.index);
    persist();
  }
  state.lastShare = {
    text: `\u{1F514} SEXTON · rang a ${result.length} of Plain Bob for the ${r.year.type} · came round on the last row · ${HOST}`,
    year: r.year,
  };
  state.screen = 'share';
  render();
}

// --- rendering ---
const app = document.getElementById('app');
function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') node.className = attrs[k];
    else if (k === 'onclick') node.addEventListener('click', attrs[k]);
    else if (k === 'html') node.innerHTML = attrs[k];
    else node.setAttribute(k, attrs[k]);
  }
  (children || []).forEach((c) => { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return node;
}

function rowDisplay(row, opts) {
  opts = opts || {};
  const wrap = el('div', { class: 'rowdisplay' });
  row.forEach((bell) => {
    const cls = ['bell'];
    if (bell === 1) cls.push('you');
    if (state.pulse[bell]) cls.push('rung');
    wrap.appendChild(el('div', { class: cls.join(' ') }, [String(bell)]));
  });
  return wrap;
}

function actionRow(onTap, disabled) {
  const wrap = el('div', { class: 'actionrow' });
  [['IN', 'Move in'], ['STAY', 'Dwell'], ['OUT', 'Move out']].forEach(([action, label]) => {
    wrap.appendChild(el('button', { onclick: () => !disabled && onTap(action) }, [label]));
  });
  return wrap;
}

function screenTitle() {
  const s = el('div', { class: 'screen' });
  s.appendChild(el('h1', {}, ['SEXTON']));
  s.appendChild(el('p', { class: 'voice' }, ['"Grab the rope. I’ll teach you the way the tower talks."']));
  s.appendChild(el('p', {}, ['A game of real English change-ringing. You ring the treble; the method tells you where to go. Ring the village’s procedural years — weddings, harvests, the quiet funerals — a life told in permutations.']));
  const hasProgress = state.save.unlocked.n3 || state.save.completedYears.length;
  const stack = el('div', { class: 'stack' });
  stack.appendChild(el('button', { class: 'primary wide', onclick: () => goPractice() }, [hasProgress ? 'Continue Ringing' : 'Begin']));
  stack.appendChild(el('button', { class: 'wide', onclick: () => { state.screen = 'howto'; render(); } }, ['How the Bells Work']));
  if (state.save.unlocked.doubles) {
    stack.appendChild(el('button', { class: 'wide', onclick: () => goVillage() }, ['The Village Years']));
  }
  s.appendChild(stack);
  s.appendChild(el('footer', {}, ['stone tower · rope-worn wood · dawn light']));
  return s;
}

function screenHowto() {
  const s = el('div', { class: 'screen' });
  s.appendChild(topbar('How the Bells Work', 'title'));
  s.appendChild(el('p', { class: 'voice' }, ['"Listen. It is simpler than it sounds, and harder than it looks."']));
  s.appendChild(el('p', {}, ['Bells ring in a ROW — an order. Start at ROUNDS: 1, 2, 3… highest bell first. Every change, most bells swap with a neighbour. You ring bell 1, the treble — the highest, and the one that always moves.']));
  s.appendChild(el('p', {}, ['Your bell walks: out toward the back, one place a blow, then — at the very back — it dwells one extra blow before turning round and walking back in. That is called PLAIN HUNTING, and it is the whole of Plain Hunt.']));
  s.appendChild(el('p', {}, ['Later, on five bells, you’ll learn PLAIN BOB DOUBLES — the same hunting, but every so often the conductor calls the bells behind you into a different order. A "bob" or a "single." Here is the part that will surprise you: whatever is called, YOUR bell never changes what it does. Watch for it.']));
  s.appendChild(el('button', { class: 'primary wide', onclick: () => goPractice() }, ['I’m ready — give me the rope']));
  return s;
}

function goPractice() {
  const u = state.save.unlocked;
  const n = !u.n3 ? 3 : !u.n4 ? 4 : !u.n5 ? 5 : (u.doubles ? null : 5);
  if (n === null) { goDoubles(); return; }
  newPracticeRound(n);
  state.screen = 'practice';
  render();
}
function goDoubles() {
  newDoublesTutorial();
  state.screen = 'doubles';
  render();
}
function goVillage() {
  if (!state.village) state.village = { years: generateVillageYears(state.save.seed, 12) };
  state.screen = 'village';
  render();
}

function topbar(title, backScreen) {
  const bar = el('div', { class: 'topbar' });
  bar.appendChild(el('button', { onclick: () => { state.screen = backScreen; render(); } }, ['← back']));
  bar.appendChild(el('h2', {}, [title]));
  bar.appendChild(el('span', {}, ['']));
  return bar;
}

function screenPractice() {
  const p = state.practice;
  const s = el('div', { class: 'screen' });
  s.appendChild(topbar(`Plain Hunt on ${p.n}`, 'title'));
  const complete = p.stepIndex >= p.rows.length - 1;
  s.appendChild(rowDisplay(p.rows[p.stepIndex]));
  s.appendChild(el('p', { class: 'hint' }, [`Row ${p.stepIndex + 1} of ${p.rows.length}. Your bell is the gold one. Where does it go next?`]));
  s.appendChild(el('div', { class: `msg ${state.msgKind}` }, [state.msg]));
  if (!complete) {
    s.appendChild(actionRow(practiceTap));
  } else {
    const next = p.n < 5 ? () => { newPracticeRound(p.n + 1); render(); } : () => goDoubles();
    s.appendChild(el('button', { class: 'primary wide', onclick: next }, [p.n < 5 ? `On to ${p.n + 1} bells` : 'On to Plain Bob Doubles']));
  }
  return s;
}

function screenDoubles() {
  const d = state.doubles;
  const s = el('div', { class: 'screen' });
  s.appendChild(topbar('Plain Bob Doubles', 'title'));
  const complete = d.leadIndex >= d.calls.length;
  if (complete) {
    s.appendChild(el('p', { class: 'voice' }, ['"There it is. However I call it, you never had to think twice. That is the treble’s gift — and its whole job."']));
    s.appendChild(rowDisplay(rounds(5)));
    s.appendChild(el('button', { class: 'primary wide', onclick: () => goVillage() }, ['Ring for the village']));
    return s;
  }
  const call = d.calls[d.leadIndex];
  const row = d.rowsAll[d.rowsAll.length - 1];
  s.appendChild(el('p', { class: 'hint' }, [`Lead ${d.leadIndex + 1} of ${d.calls.length} · row ${d.stepIndex + 1} of 10`]));
  s.appendChild(rowDisplay(row));
  if (d.revealed) {
    s.appendChild(el('div', { class: 'card stack' }, [
      el('p', { class: 'voice' }, [`"The conductor calls '${call.toUpperCase()}.' Watch bell 1 — top row, every time."`]),
      labelledRow('plain', applyPlaceNotation(row, CALL_TOKENS.plain, 5)),
      labelledRow('bob', applyPlaceNotation(row, CALL_TOKENS.bob, 5)),
      labelledRow('single', applyPlaceNotation(row, CALL_TOKENS.single, 5)),
      el('p', { class: 'hint' }, ['Bell 1 leads in all three. Only the band behind it changes.']),
      el('button', { class: 'primary wide', onclick: doublesConfirmReveal }, ['I see it — ring on']),
    ]));
    return s;
  }
  if (d.stepIndex === 9) {
    s.appendChild(el('div', { class: 'callbanner' }, [call]));
  }
  s.appendChild(el('div', { class: `msg ${state.msgKind}` }, [state.msg]));
  s.appendChild(actionRow(doublesTap));
  return s;
}
function labelledRow(label, row) {
  const wrap = el('div', {});
  wrap.appendChild(el('div', { class: 'hint' }, [label]));
  wrap.appendChild(rowDisplay(row));
  return wrap;
}

function screenVillage() {
  const s = el('div', { class: 'screen' });
  s.appendChild(topbar('The Village Years', 'title'));
  s.appendChild(el('p', { class: 'voice' }, ['"Twelve years. Ring what the tower is asked for."']));
  const list = el('div', { class: 'yearlist' });
  state.village.years.forEach((y, i) => {
    const done = state.save.completedYears.includes(i);
    const card = el('div', { class: 'card yearcard' }, [
      el('div', { class: 'meta' }, [
        el('div', { class: 'year' }, [String(y.year), el('span', { class: 'badge' }, [`${y.leads} leads · ${y.length} changes`])]),
        el('div', { class: 'hint' }, [y.voice]),
      ]),
      done ? el('div', { class: 'done' }, ['✓']) : el('button', { onclick: () => { startYear(i); render(); } }, ['Ring']),
    ]);
    list.appendChild(card);
  });
  s.appendChild(list);
  return s;
}

function screenRing() {
  const r = state.activeYear;
  const s = el('div', { class: 'screen' });
  s.appendChild(topbar(String(r.year.year), 'village'));
  s.appendChild(el('p', { class: 'hint' }, [r.year.voice]));
  const call = r.year.calls[r.leadIndex];
  const row = r.rowsAll[r.rowsAll.length - 1];
  s.appendChild(el('p', { class: 'hint' }, [`Lead ${r.leadIndex + 1} of ${r.year.calls.length} · row ${r.stepIndex + 1} of 10`]));
  s.appendChild(rowDisplay(row));
  if (r.stepIndex === 9) s.appendChild(el('div', { class: 'callbanner' }, [call]));
  s.appendChild(el('div', { class: `msg ${state.msgKind}` }, [state.msg]));
  s.appendChild(actionRow(ringTap));
  return s;
}

function screenShare() {
  const s = el('div', { class: 'screen' });
  const share = state.lastShare;
  s.appendChild(el('h2', {}, ['Came Round']));
  s.appendChild(rowDisplay(rounds(5)));
  s.appendChild(el('p', { class: 'voice' }, [`Rung for the ${share.year.type} of ${share.year.year}.`]));
  s.appendChild(el('div', { class: 'card' }, [el('p', { html: escapeHtml(share.text) })]));
  const stack = el('div', { class: 'stack' });
  stack.appendChild(el('button', { class: 'primary wide', onclick: () => shareOrCopy(share.text) }, ['Share']));
  stack.appendChild(el('button', { class: 'wide', onclick: () => goVillage() }, ['Back to the village']));
  s.appendChild(stack);
  return s;
}
function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
function shareOrCopy(text) {
  if (navigator.share) { navigator.share({ text }).catch(() => {}); }
  else if (navigator.clipboard) { navigator.clipboard.writeText(text).then(() => setMsg('Copied.', 'good')); }
}

function render() {
  app.innerHTML = '';
  const map = {
    title: screenTitle, howto: screenHowto, practice: screenPractice,
    doubles: screenDoubles, village: screenVillage, ring: screenRing, share: screenShare,
  };
  const fn = map[state.screen] || screenTitle;
  app.appendChild(fn());
}

render();

// --- dev hook: ?dev=1 exposes window.__g for headless/scripted driving ---
if (new URLSearchParams(location.search).get('dev') === '1') {
  window.__g = {
    getState: () => JSON.parse(JSON.stringify({ screen: state.screen, save: state.save, msg: state.msg })),
    goTitle: () => { state.screen = 'title'; render(); },
    goHowto: () => { state.screen = 'howto'; render(); },
    goPractice, goDoubles, goVillage,
    startYear: (i) => { startYear(i); render(); },
    tap: (action) => {
      if (state.screen === 'practice') practiceTap(action);
      else if (state.screen === 'doubles') { if (state.doubles.revealed) doublesConfirmReveal(); else doublesTap(action); }
      else if (state.screen === 'ring') ringTap(action);
    },
    reset: () => { try { localStorage.removeItem(STORAGE_KEY); } catch (e) {} state.save = loadSave(); state.village = null; state.screen = 'title'; render(); },
    step,
  };
}

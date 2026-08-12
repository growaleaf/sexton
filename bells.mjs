// bells.mjs — the pure kernel of SEXTON.
// Real English change-ringing: rows are permutations of bell numbers 1..n
// (1 = treble, highest pitch). A "place notation" token names the positions
// that stay fixed on a change; every other position swaps with its neighbour
// in a contiguous pair. This file has no DOM, no WebAudio, no Date.now(),
// no Math.random() — every source of variation is an injected seed.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rounds(n) {
  return Array.from({ length: n }, (_, i) => i + 1);
}

export function rowString(row) {
  return row.join('');
}

export function rowKey(row) {
  return row.join(',');
}

// Apply one place-notation change to a row. `token` is a string of digits
// naming positions that are "made" (stay fixed), or 'X'/'-' for a full
// cross (only valid when every remaining position pairs up, i.e. even n
// with no digits). Positions are 1-indexed, matching campanology convention.
export function applyPlaceNotation(row, token, n) {
  n = n || row.length;
  const fixed = new Set();
  if (token !== 'X' && token !== '-') {
    for (const ch of String(token)) fixed.add(parseInt(ch, 10));
  }
  const result = row.slice();
  let i = 1;
  while (i <= n) {
    if (fixed.has(i)) { i += 1; continue; }
    if (i + 1 <= n && !fixed.has(i + 1)) {
      const tmp = result[i - 1];
      result[i - 1] = result[i];
      result[i] = tmp;
      i += 2;
    } else {
      i += 1;
    }
  }
  return result;
}

// Plain Hunt on n bells alternates two changes: cross from the front,
// placing the odd bell (if any) at the back; then hold the front bell and
// cross from the second place, placing the odd bell (if any) at the back
// too when n is even. This is the standard generative rule for plain
// hunting on any number of bells (verified against a published row for
// n=5: row 9 of continuous plain hunt from rounds is 13254).
export function plainHuntFixedSets(n) {
  const fixedA = n % 2 === 1 ? [n] : [];
  const fixedB = [1, ...(n % 2 === 0 ? [n] : [])];
  return { fixedA, fixedB };
}

export function plainHuntTokens(n) {
  const { fixedA, fixedB } = plainHuntFixedSets(n);
  const tokA = fixedA.length ? fixedA.join('') : 'X';
  const tokB = fixedB.join('');
  return [tokA, tokB];
}

// Rows[0] is rounds; rows[i] is the row after i changes of continuous
// plain hunting. Length steps+1.
export function plainHuntRows(n, steps) {
  const [tokA, tokB] = plainHuntTokens(n);
  let row = rounds(n);
  const rows = [row.slice()];
  for (let i = 0; i < steps; i += 1) {
    const tok = i % 2 === 0 ? tokA : tokB;
    row = applyPlaceNotation(row, tok, n);
    rows.push(row.slice());
  }
  return rows;
}

// --- Plain Bob Doubles (5 bells) ---
// One lead = 9 rows of plain hunt, then a 10th "lead end" change that
// depends on what the conductor calls. Verified against published sources:
// plain lead end "125" turns row 13254 into 13524 (places 1,2,5 made,
// 3-4 dodge/cross); a bob's lead end is "145" (places 1,4,5 made, 2-3
// cross — the bell that would dodge 3-4 instead runs in/out at 2-3); a
// single's lead end is "123" (places 1,2,3 made, 4-5 cross). Every one of
// the three keeps position 1 fixed — the treble always dwells at lead
// through a lead end no matter what is called; only the band behind it
// reshuffles. That invariant is the game's central "gasp" fact.
export const DOUBLES_HUNT_TOKENS = ['5', '1', '5', '1', '5', '1', '5', '1', '5'];
export const CALL_TOKENS = { plain: '125', bob: '145', single: '123' };
export const CALLS = ['plain', 'bob', 'single'];

export function ringDoublesLead(startRow, call) {
  if (startRow.length !== 5) throw new Error('doubles is 5 bells');
  const token = CALL_TOKENS[call];
  if (!token) throw new Error(`unknown call: ${call}`);
  let row = startRow.slice();
  const rows = [];
  for (const t of DOUBLES_HUNT_TOKENS) {
    row = applyPlaceNotation(row, t, 5);
    rows.push(row);
  }
  row = applyPlaceNotation(row, token, 5);
  rows.push(row);
  return rows; // 10 new rows
}

// Ring a whole touch: a sequence of calls, one per lead, starting and
// (hopefully) ending at rounds. Reports whether it truly comes round and
// whether it is "true" — no row repeats before the very last one, the
// real campanology definition of a valid touch.
export function ringTouch(calls) {
  let row = rounds(5);
  const allRows = [row.slice()];
  for (const call of calls) {
    const lead = ringDoublesLead(row, call);
    for (const r of lead) allRows.push(r);
    row = lead[lead.length - 1];
  }
  const seen = new Set();
  let isTrue = true;
  for (let i = 0; i < allRows.length - 1; i += 1) {
    const k = rowKey(allRows[i]);
    if (seen.has(k)) { isTrue = false; break; }
    seen.add(k);
  }
  const comesRound = rowKey(row) === rowKey(rounds(5));
  return { rows: allRows, length: allRows.length - 1, comesRound, isTrue };
}

// Compose a true touch of exactly `leads` leads that comes round, by
// deterministic depth-first search with truth-pruning (a row that has
// already rung anywhere earlier in the touch kills that branch). `seed`
// only reorders which call is tried first at each node — same seed always
// finds the same touch; different seeds explore different true touches
// when more than one exists. Returns null if no true touch of that exact
// length exists.
export function composeTouch(leads, seed = 1) {
  const rnd = mulberry32(seed);
  const order = CALLS.slice();
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const roundsKey = rowKey(rounds(5));
  const seen = new Set([roundsKey]);
  const calls = [];

  function dfs(row, leadsLeft) {
    for (const call of order) {
      const lead = ringDoublesLead(row, call);
      const keys = lead.map(rowKey);
      if (new Set(keys).size !== keys.length) continue; // repeats within the lead itself
      const isFinalLead = leadsLeft === 1;
      let clash = false;
      for (let idx = 0; idx < keys.length; idx += 1) {
        const isClosingRow = isFinalLead && idx === keys.length - 1;
        if (isClosingRow) {
          // the whole point: the last row of the last lead must be rounds,
          // and is exempt from the "never seen before" trueness check.
          if (keys[idx] !== roundsKey) clash = true;
          continue;
        }
        if (seen.has(keys[idx])) { clash = true; break; }
      }
      if (clash) continue;
      const toAdd = isFinalLead ? keys.slice(0, -1) : keys;
      for (const k of toAdd) seen.add(k);
      calls.push(call);
      if (isFinalLead || dfs(lead[lead.length - 1], leadsLeft - 1)) return true;
      calls.pop();
      for (const k of toAdd) seen.delete(k);
    }
    return false;
  }

  return dfs(rounds(5), leads) ? calls.slice() : null;
}

// --- player-track validator ---
// The treble's path through any row sequence is fully determined by the
// method. `trebleAction` classifies the move that already happened;
// `legalNextPlaces` and `checkPlayerAction` let the game ask "what SHOULD
// I do here" before the row advances.
export function trebleAction(rows, stepIndex) {
  const cur = rows[stepIndex].indexOf(1) + 1;
  const nxt = rows[stepIndex + 1].indexOf(1) + 1;
  if (nxt === cur) return 'STAY';
  return nxt < cur ? 'IN' : 'OUT';
}

export function legalNextPlaces(rows, stepIndex) {
  return [rows[stepIndex + 1].indexOf(1) + 1];
}

export function checkPlayerAction(rows, stepIndex, chosenAction) {
  return trebleAction(rows, stepIndex) === chosenAction;
}

// --- village years ---
// 12 procedural years of village life, each asking for a touch of a
// certain length. Deterministic given a seed; every year's touch is
// pre-composed so the game can guarantee, before the player ever taps,
// that it truly comes round.
const EVENT_TYPES = ['wedding', 'harvest', 'christening', 'jubilee', 'new year', 'funeral'];
const EVENT_VOICE = {
  wedding: 'a wedding peal, for two who said yes at the lychgate',
  harvest: 'the harvest touch, called the moment the last wagon came in',
  christening: 'a christening touch, five bells for a name not yet worn in',
  jubilee: 'the jubilee touch, called because someone in the village turned a hundred',
  'new year': "the new year's touch, rung into the dark before anyone's awake to hear it start",
  funeral: 'a quiet touch, rung slow, for someone the tower will miss',
};
// Every lead-end change (plain/bob/single) is a single transposition — an
// odd permutation — riding on top of 9 even plain-hunt changes, so a whole
// lead is always odd-parity. An odd number of leads can never multiply
// back to the identity: only an EVEN lead count can ever come round.
// Verified by exhaustive search (composeTouch returns null for every odd
// count 1-11, and a true touch for every even count 2-12).
const FEASIBLE_LEADS = [2, 4, 6, 8, 12];

export function generateVillageYears(seed, count = 12) {
  const rnd = mulberry32(seed);
  const startYear = 1700 + Math.floor(rnd() * 250);
  const years = [];
  for (let i = 0; i < count; i += 1) {
    const type = EVENT_TYPES[Math.floor(rnd() * EVENT_TYPES.length)];
    const leads = FEASIBLE_LEADS[Math.floor(rnd() * FEASIBLE_LEADS.length)];
    const touchSeed = Math.floor(rnd() * 1e9);
    const calls = composeTouch(leads, touchSeed);
    years.push({
      year: startYear + i,
      type,
      voice: EVENT_VOICE[type],
      leads,
      length: leads * 10,
      touchSeed,
      calls,
    });
  }
  return years;
}

// --- audio schedule ---
// Flattens a row sequence into an ordered list of blows (who strikes,
// which row, which position) for game.js to time against WebAudio. Pure
// data — no scheduling side effects live here.
export function audioSchedule(rows) {
  const blows = [];
  rows.forEach((row, rowIndex) => {
    row.forEach((bell, idx) => {
      blows.push({ rowIndex, position: idx + 1, bell });
    });
  });
  return blows;
}

// --- save/share codec ---
// A village's progress round-trips through a short base64 string so it
// can live in localStorage (and, later, be pasted to share). btoa/atob
// are the only non-pure calls here; game.js supplies them (or test.mjs
// shims them for node).
export function encodeSave(state, b64encode) {
  return b64encode(JSON.stringify(state));
}

export function decodeSave(str, b64decode) {
  return JSON.parse(b64decode(str));
}

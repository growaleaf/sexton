// test.mjs — headless verification of SEXTON's kernel. `node test.mjs`, exit 0 = green.
import {
  mulberry32, rounds, rowString, applyPlaceNotation,
  plainHuntTokens, plainHuntRows, ringDoublesLead, ringTouch, composeTouch,
  trebleAction, legalNextPlaces, checkPlayerAction, generateVillageYears,
  audioSchedule, encodeSave, decodeSave, CALLS,
} from './bells.mjs';

// Node has no btoa/atob.
const b64encode = (s) => Buffer.from(s, 'utf8').toString('base64');
const b64decode = (s) => Buffer.from(s, 'base64').toString('utf8');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log(`ok   ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// 1. determinism — same inputs, same outputs, repeated calls.
check('plainHuntRows(5,10) is deterministic across calls',
  eq(plainHuntRows(5, 10), plainHuntRows(5, 10)));

// 2. Plain Hunt on 3 bells — hand-derived and cross-checked truth table.
const PH3 = ['123', '213', '231', '321', '312', '132', '123'];
check('Plain Hunt on 3 bells matches truth table (period 6)',
  eq(plainHuntRows(3, 6).map(rowString), PH3),
  JSON.stringify(plainHuntRows(3, 6).map(rowString)));

// 3. Plain Hunt on 4 bells — hand-derived truth table.
const PH4 = ['1234', '2143', '2413', '4231', '4321', '3412', '3142', '1324', '1234'];
check('Plain Hunt on 4 bells matches truth table (period 8)',
  eq(plainHuntRows(4, 8).map(rowString), PH4),
  JSON.stringify(plainHuntRows(4, 8).map(rowString)));

// 4. Plain Hunt on 5 bells — verified against a published row (row 9 = 13254,
// treblesgoing.org.uk / wiki.changeringing.co.uk).
const PH5 = ['12345', '21435', '24153', '42513', '45231', '54321', '53412', '35142', '31524', '13254', '12345'];
check('Plain Hunt on 5 bells matches truth table, row 9 is the published 13254',
  eq(plainHuntRows(5, 10).map(rowString), PH5),
  JSON.stringify(plainHuntRows(5, 10).map(rowString)));

// 5. Plain Bob Doubles plain lead — verified: 9 rows of plain hunt then
// 13254 -> 13524 at the lead end (rsw.me.uk blueline / changeringing wiki:
// "one bell makes 2nds, one makes 5ths, the other two dodge in 3-4").
const plainLead = ringDoublesLead(rounds(5), 'plain').map(rowString);
check('Plain Bob Doubles plain lead ends 13524',
  eq(plainLead, ['21435', '24153', '42513', '45231', '54321', '53412', '35142', '31524', '13254', '13524']),
  JSON.stringify(plainLead));

// 6. The three calls diverge at the lead end but all keep the treble at lead.
const afterPlain = ringDoublesLead(rounds(5), 'plain');
const afterBob = ringDoublesLead(rounds(5), 'bob');
const afterSingle = ringDoublesLead(rounds(5), 'single');
const lastPlain = rowString(afterPlain[9]), lastBob = rowString(afterBob[9]), lastSingle = rowString(afterSingle[9]);
check('plain, bob, single lead ends are three different rows',
  lastPlain !== lastBob && lastBob !== lastSingle && lastPlain !== lastSingle,
  `${lastPlain} ${lastBob} ${lastSingle}`);
check('treble (bell 1) dwells at lead through every kind of lead end',
  [afterPlain, afterBob, afterSingle].every((rows) => rows[9][0] === 1));

// 7. A plain course (all-plain calls) of Plain Bob Doubles closes after
// exactly 4 leads (40 changes) — the standard fact for doubles.
const plainCourse = ringTouch(['plain', 'plain', 'plain', 'plain']);
check('plain course of 4 leads (40 changes) comes round',
  plainCourse.comesRound && plainCourse.length === 40,
  `comesRound=${plainCourse.comesRound} length=${plainCourse.length}`);
check('plain course of 4 leads is true (no repeated row)', plainCourse.isTrue);

// 8. composeTouch finds a true, round touch for every feasible lead count,
// and ringTouch independently confirms it.
const FEASIBLE = [2, 4, 6, 8, 12];

// 8b. odd lead counts are mathematically impossible (parity proof: every
// lead is an odd permutation, so only an even number of leads can ever
// multiply back to the identity/rounds) — composeTouch must agree.
let oddImpossible = true, oddDetail = '';
for (const leads of [1, 3, 5, 7, 9, 11]) {
  if (composeTouch(leads, 1) !== null) { oddImpossible = false; oddDetail = `leads=${leads} unexpectedly found`; break; }
}
check('odd lead counts have no true touch (parity), composeTouch agrees', oddImpossible, oddDetail);
let allComposed = true, composeDetail = '';
for (const leads of FEASIBLE) {
  const calls = composeTouch(leads, 1);
  if (!calls) { allComposed = false; composeDetail += `leads=${leads}:null `; continue; }
  const result = ringTouch(calls);
  if (!(result.comesRound && result.isTrue && result.length === leads * 10)) {
    allComposed = false;
    composeDetail += `leads=${leads}:bad(${result.comesRound},${result.isTrue},${result.length}) `;
  }
}
check('composeTouch finds a true, round touch for every feasible lead count', allComposed, composeDetail);

// 9. A composed 12-lead touch (a "120") really visits 120 distinct rows —
// the whole extent of 5 bells (5! = 120).
const wholeExtent = composeTouch(12, 1);
const wholeResult = wholeExtent ? ringTouch(wholeExtent) : null;
check('a composed 12-lead touch is a true 120 (the whole extent)',
  !!wholeResult && wholeResult.comesRound && wholeResult.isTrue && wholeResult.length === 120,
  wholeResult ? JSON.stringify({ comesRound: wholeResult.comesRound, isTrue: wholeResult.isTrue, length: wholeResult.length }) : 'null');

// 10. composeTouch determinism — same seed, same result.
check('composeTouch is deterministic for a fixed seed',
  eq(composeTouch(4, 7), composeTouch(4, 7)));

// 11. bounds — composeTouch succeeds for every feasible lead length across
// 100 different seeds (never silently produces a false or unclosed touch).
let boundsOk = true, boundsDetail = '';
for (let seed = 1; seed <= 100; seed += 1) {
  for (const leads of FEASIBLE) {
    const calls = composeTouch(leads, seed);
    if (!calls) { boundsOk = false; boundsDetail = `seed=${seed} leads=${leads} null`; break; }
    const r = ringTouch(calls);
    if (!(r.comesRound && r.isTrue)) { boundsOk = false; boundsDetail = `seed=${seed} leads=${leads} untrue`; break; }
  }
  if (!boundsOk) break;
}
check('composeTouch succeeds across 100 seeds for every feasible length', boundsOk, boundsDetail);

// 12. village years — 12 procedural years, all individually satisfiable,
// checked across 100 seeds (REQUIRED TESTS: "12 years of events all
// satisfiable").
let yearsOk = true, yearsDetail = '';
for (let seed = 1; seed <= 100; seed += 1) {
  const years = generateVillageYears(seed, 12);
  if (years.length !== 12) { yearsOk = false; yearsDetail = `seed=${seed} count=${years.length}`; break; }
  for (const y of years) {
    if (!y.calls) { yearsOk = false; yearsDetail = `seed=${seed} year=${y.year} type=${y.type} leads=${y.leads} unsatisfiable`; break; }
    if (y.calls.length !== y.leads) { yearsOk = false; yearsDetail = `seed=${seed} call length mismatch`; break; }
  }
  if (!yearsOk) break;
}
check('12 procedural village years are all satisfiable across 100 seeds', yearsOk, yearsDetail);

// 13. village years determinism.
check('generateVillageYears is deterministic for a fixed seed',
  eq(generateVillageYears(42, 12), generateVillageYears(42, 12)));

// 14. validator — trebleAction over a full plain hunt on 5 bells dwells
// (STAYs) exactly at both extremes and never anywhere else.
const rows5 = plainHuntRows(5, 10);
const actions = [];
for (let i = 0; i < 10; i += 1) actions.push(trebleAction(rows5, i));
check('treble action sequence over plain hunt on 5 matches the hunt shape',
  eq(actions, ['OUT', 'OUT', 'OUT', 'OUT', 'STAY', 'IN', 'IN', 'IN', 'IN', 'STAY']),
  JSON.stringify(actions));

// 15. legalNextPlaces always returns exactly one place, and it matches the
// row that actually follows.
let validatorOk = true;
for (let i = 0; i < 10; i += 1) {
  const places = legalNextPlaces(rows5, i);
  const actual = rows5[i + 1].indexOf(1) + 1;
  if (places.length !== 1 || places[0] !== actual) validatorOk = false;
}
check('legalNextPlaces admits exactly the one legal next place, every step', validatorOk);

// 16. checkPlayerAction rejects a wrong action and accepts the right one.
check('checkPlayerAction accepts the correct action',
  checkPlayerAction(rows5, 0, trebleAction(rows5, 0)));
check('checkPlayerAction rejects a wrong action',
  !checkPlayerAction(rows5, 0, trebleAction(rows5, 0) === 'STAY' ? 'IN' : 'STAY'));

// 17. audioSchedule produces the right number of blows (rows * bells).
const schedule = audioSchedule(rows5);
check('audioSchedule flattens to rows*bells blows',
  schedule.length === rows5.length * 5,
  `${schedule.length} vs ${rows5.length * 5}`);

// 18. save/share codec round-trips.
const sampleState = { seed: 42, completedYears: [1, 3, 5], bells: 5 };
const encoded = encodeSave(sampleState, b64encode);
const decoded = decodeSave(encoded, b64decode);
check('encodeSave/decodeSave round-trips a village state', eq(decoded, sampleState));

// 19. mulberry32 determinism and bounds across 100 seeds.
let prngOk = true;
for (let seed = 1; seed <= 100; seed += 1) {
  const r1 = mulberry32(seed), r2 = mulberry32(seed);
  for (let i = 0; i < 5; i += 1) {
    const a = r1(), b = r2();
    if (a !== b || a < 0 || a >= 1) { prngOk = false; break; }
  }
  if (!prngOk) break;
}
check('mulberry32 is deterministic and bounded in [0,1) across 100 seeds', prngOk);

// 20. applyPlaceNotation full-cross token 'X' behaves correctly on even n.
check("applyPlaceNotation('X') on 4 bells fully crosses in pairs",
  eq(applyPlaceNotation([1, 2, 3, 4], 'X', 4), [2, 1, 4, 3]));

// 21. CALLS constant matches the three implemented call types.
check('CALLS lists exactly plain, bob, single', eq(CALLS, ['plain', 'bob', 'single']));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

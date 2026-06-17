/*
 * Node test harness for grade-converter.js, run against the synthetic sample
 * exports shipped in the repo ("From Doenet.csv" / "From Canvas.csv"). No deps.
 *   run:  node test/grade-converter.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const GC = require(join(root, 'grade-converter.js'));

let passed = 0;
let failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra ? '  -> ' + extra : '')); }
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  ok(name, a === e, 'got ' + a + ', expected ' + e);
}

const doenetText = readFileSync(join(root, 'From Doenet.csv'), 'utf8');
const canvasText = readFileSync(join(root, 'From Canvas.csv'), 'utf8');

// ---------------------------------------------------------------------------
console.log('\nCSV parsing');
const dRows = GC.parseCSV(doenetText);
const cRows = GC.parseCSV(canvasText);
eq('doenet header', dRows[0], ['First name', 'Last name', 'Student ID', 'Sample Activity 1']);
eq('doenet row count (13 students)', dRows.length - 1, 13);
ok('canvas student with comma stays one field',
  GC.parseCSV('"Garcia Lopez, Maria Elena",2000007')[0].length === 2);
eq('quoted "" escape', GC.parseCSV('"a ""b"" c",d')[0], ['a "b" c', 'd']);
eq('embedded newline in quotes', GC.parseCSV('"line1\nline2",x').length, 1);

// ---------------------------------------------------------------------------
console.log('\nDoenet detection');
const dd = GC.detectDoenet(dRows);
eq('first/last/id/score indices', [dd.firstIdx, dd.lastIdx, dd.idIdx, dd.scoreIdx], [0, 1, 2, 3]);
eq('score header', dd.scoreHeader, 'Sample Activity 1');

// ---------------------------------------------------------------------------
console.log('\nCanvas detection');
const cc = GC.detectCanvas(cRows);
eq('points possible row detected', cc.pointsPossibleRow != null, true);
eq('id columns are Student,ID,SIS Login ID,Section', cc.idCols, [0, 1, 2, 3]);
eq('first 5 assignment names',
  cc.assignments.slice(0, 6).map((a) => a.name),
  ['Roll Call Attendance', 'Test 1', 'Test 2', 'Test 3', 'Test 4', 'Bonus Activity']);
eq('Test 1 has id + points possible',
  cc.assignments.find((a) => a.name === 'Test 1'),
  { index: 5, name: 'Test 1', id: '1000002', header: 'Test 1 (1000002)', pointsPossible: '100.00' });

// ---------------------------------------------------------------------------
console.log('\nName matching against the sample roster');
const doenetStudents = dd.data
  .filter((r) => !GC.isBlankRow(r))
  .map((r) => GC.doenetName(r[dd.firstIdx], r[dd.lastIdx]));
const canvasStudents = cc.data.map((r) => GC.parseCanvasStudent(r[cc.studentIdx]));
const matches = GC.autoMatch(doenetStudents, canvasStudents);

function canvasNameFor(i) {
  const m = matches[i];
  return m.canvasIdx == null ? null : canvasStudents[m.canvasIdx].raw;
}
function byDoenet(name) {
  const i = doenetStudents.findIndex((d) => d.display.toLowerCase() === name.toLowerCase());
  return { i, match: matches[i], canvas: canvasNameFor(i) };
}

// Exact flips (name order + case + trailing space) should all be HIGH matches.
[
  ['Alice Apple', 'Apple, Alice'],
  ['Bob Brooks', 'Brooks, Bob'],
  ['Carlos Cruz', 'Cruz, Carlos'],
  ['Dana Diaz', 'Diaz, Dana'],
  ['erin evans', 'Evans, Erin'],
  ['Frank Flores', 'Flores, Frank'],
  ['Grace Gomez', 'Gomez, Grace'],
].forEach(([d, c]) => {
  const r = byDoenet(d);
  ok(`${d} -> ${c} (high)`, r.canvas === c && r.match.confidence === 'high',
    `got ${r.canvas} / ${r.match && r.match.confidence}`);
});

// Fuzzy partial: "Maria Lopez" -> "Garcia Lopez, Maria Elena" (likely).
{
  const r = byDoenet('Maria Lopez');
  ok('Maria Lopez -> Garcia Lopez, Maria Elena (likely)',
    r.canvas === 'Garcia Lopez, Maria Elena' && r.match.confidence === 'likely',
    `got ${r.canvas} / ${r.match && r.match.confidence}`);
}

// These Doenet entries have no Canvas counterpart and must stay unmatched.
['Ivy Instructor', 'Nina Okafor', 'ghostuser', 'cooldude', 'demo user'].forEach((d) => {
  const r = byDoenet(d);
  ok(`${d} stays unmatched`, r.match && r.match.canvasIdx === null,
    `got ${r.canvas}`);
});

// No Canvas student is matched twice.
{
  const used = matches.map((m) => m.canvasIdx).filter((x) => x != null);
  ok('no canvas student double-matched', new Set(used).size === used.length);
}

// ---------------------------------------------------------------------------
console.log('\nGrade transform');
eq('percent 85 of 20 -> 17', GC.transformScore('85', 'percent', 20), '17');
eq('percent 12.5 of 100 -> 12.5', GC.transformScore('12.5', 'percent', 100), '12.5');
eq('percent 100 of 100 -> 100', GC.transformScore('100', 'percent', 100), '100');
eq('copy passes through', GC.transformScore('73.5', 'copy', 100), '73.5');
eq('blank stays blank', GC.transformScore('', 'percent', 100), '');
eq('percent with blank points -> blank (not 0)', GC.transformScore('85', 'percent', ''), '');
eq('percent with zero points -> blank (not 0)', GC.transformScore('85', 'percent', 0), '');
eq('percent with non-numeric points -> blank', GC.transformScore('85', 'percent', '(read only)'), '');
eq('locale comma NOT stripped -> blank (not 875)', GC.transformScore('87,5', 'percent', 100), '');
eq('thousands group NOT stripped -> blank', GC.transformScore('1,234', 'copy', 100), '');
eq('scientific notation rejected -> blank', GC.transformScore('1e2', 'copy', 100), '');
eq('garbage rejected -> blank', GC.transformScore('8-5', 'copy', 100), '');
eq('trailing percent sign tolerated', GC.transformScore('85%', 'copy', 100), '85');

// ---------------------------------------------------------------------------
console.log('\nMatching confidence rules');
// Single shared surname must NOT auto-match (was a silent wrong-grade risk).
{
  const d = [GC.doenetName('', 'zeta')];                // one token: "zeta"
  const c = [GC.parseCanvasStudent('Vance, Zeta')];     // tokens: vance, zeta
  ok('single shared token stays unmatched', GC.autoMatch(d, c)[0].canvasIdx === null);
}
// Different middle name (subset) must be "likely", never "high".
{
  const d = [GC.doenetName('Jordan Lee', 'Park')];
  const c = [GC.parseCanvasStudent('Park, Jordan')];
  const m = GC.autoMatch(d, c)[0];
  ok('subset/middle-name match is likely, not high', m.canvasIdx === 0 && m.confidence === 'likely',
    JSON.stringify(m));
}
// Exact name (order flipped) stays "high".
{
  const d = [GC.doenetName('Quinn', 'Vega')];
  const c = [GC.parseCanvasStudent('Vega, Quinn')];
  ok('exact flipped name is high', GC.autoMatch(d, c)[0].confidence === 'high');
}

// ---------------------------------------------------------------------------
console.log('\nNew-assignment header guard');
{
  const cc2 = GC.detectCanvas(GC.parseCSV(canvasText));
  const o = GC.buildCanvasImport({ canvas: cc2, targetHeader: 'Quiz (2024)', targetPointsPossible: 100, grades: new Map(), isNew: true });
  eq('new header ending in (digits) is neutralized', o[0][o[0].length - 1], 'Quiz [2024]');
  const o2 = GC.buildCanvasImport({ canvas: cc2, targetHeader: 'Test 1 (1000002)', targetPointsPossible: 100, grades: new Map(), isNew: false });
  eq('existing header keeps its (id)', o2[0][o2[0].length - 1], 'Test 1 (1000002)');
}

// ---------------------------------------------------------------------------
console.log('\nCanvas import build (new assignment, percent -> 100 pts)');
const grades = new Map();
cc.data.forEach((r, ri) => {
  const cs = canvasStudents[ri];
  const mi = matches.findIndex((m) => m.canvasIdx === ri);
  if (mi >= 0) {
    const draw = dd.data.filter((x) => !GC.isBlankRow(x))[mi][dd.scoreIdx];
    grades.set(ri, GC.transformScore(draw, 'percent', 100));
  }
});
const outRows = GC.buildCanvasImport({
  canvas: cc, targetHeader: 'Sample Activity 1', targetPointsPossible: 100, grades,
});

eq('output header', outRows[0], ['Student', 'ID', 'SIS Login ID', 'Section', 'Sample Activity 1']);
eq('points possible row', outRows[1], ['Points Possible', '', '', '', '100']);

function outGrade(student) {
  const row = outRows.find((r) => r[0] === student);
  return row ? row[row.length - 1] : undefined;
}
eq('Apple, Alice -> 100', outGrade('Apple, Alice'), '100');
eq('Garcia Lopez (fuzzy) -> 100', outGrade('Garcia Lopez, Maria Elena'), '100');
eq('Gomez, Grace -> 100', outGrade('Gomez, Grace'), '100');
eq('unmatched Test Student -> blank', outGrade('Student, Test'), '');

// Round-trip: serialise then re-parse and confirm structure survives quoting.
const reparsed = GC.parseCSV(GC.toCSV(outRows));
eq('round-trip preserves header', reparsed[0], outRows[0]);
ok('round-trip preserves "Last, First" quoting',
  reparsed.some((r) => r[0] === 'Garcia Lopez, Maria Elena'));

// ---------------------------------------------------------------------------
console.log('\nCanvas import build (existing assignment Test 1, copy mode)');
{
  const t1 = cc.assignments.find((a) => a.name === 'Test 1');
  const g2 = new Map([[0, '95']]); // first canvas student
  const out2 = GC.buildCanvasImport({
    canvas: cc, targetHeader: t1.header, targetPointsPossible: t1.pointsPossible, grades: g2,
  });
  eq('existing header carries (id)', out2[0][4], 'Test 1 (1000002)');
  eq('existing points possible carried', out2[1][4], '100.00');
}

// ---------------------------------------------------------------------------
console.log('\nWrong-file detection basis');
{
  const dd2 = GC.detectDoenet(GC.parseCSV(canvasText));
  const named = dd2.data.filter((r) => !GC.isBlankRow(r)).filter((r) => {
    const nm = GC.doenetName(dd2.firstIdx >= 0 ? r[dd2.firstIdx] : '', dd2.lastIdx >= 0 ? r[dd2.lastIdx] : '');
    return nm.display || nm.tokens.length;
  });
  ok('a Canvas file yields 0 named Doenet students (so it is rejected)', named.length === 0, String(named.length));
  ok('a Doenet file has no Canvas ID column (so it is rejected)', GC.detectCanvas(GC.parseCSV(doenetText)).idIdx === -1);
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

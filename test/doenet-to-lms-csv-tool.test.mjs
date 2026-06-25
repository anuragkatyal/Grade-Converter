/*
 * Node test harness for doenet-to-lms-csv-tool.js, run against the synthetic sample
 * exports shipped in the repo ("From Doenet.csv" / "From Canvas.csv"). No deps.
 *   run:  node test/doenet-to-lms-csv-tool.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const GC = require(join(root, 'doenet-to-lms-csv-tool.js'));

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
const d2lText = readFileSync(join(root, 'From D2L.csv'), 'utf8');

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

// Expected grades are DERIVED from the sample file, never hard-coded — so the
// tests survive edits to the sample scores. doenetStudents[k] aligns with the
// k-th non-blank Doenet data row, so we can look a student up by display name.
const doenetRows = dd.data.filter((r) => !GC.isBlankRow(r));
function expectGrade(doenetDisplay, mode = 'percent', pp = 100) {
  const k = doenetStudents.findIndex((d) => d.display.toLowerCase() === doenetDisplay.toLowerCase());
  if (k < 0) throw new Error(`no Doenet student named "${doenetDisplay}" in the sample`);
  return GC.transformScore(doenetRows[k][dd.scoreIdx], mode, pp);
}

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
eq('Apple, Alice -> Alice Apple score', outGrade('Apple, Alice'), expectGrade('Alice Apple'));
eq('Garcia Lopez (fuzzy) -> Maria Lopez score', outGrade('Garcia Lopez, Maria Elena'), expectGrade('Maria Lopez'));
eq('Gomez, Grace -> Grace Gomez score', outGrade('Gomez, Grace'), expectGrade('Grace Gomez'));
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
console.log('\nD2L detection');
const d2lRows = GC.parseCSV(d2lText);
const d2 = GC.detectD2L(d2lRows);
eq('no Points Possible row -> data starts at first student', d2.data.length, 9);
eq('identifier columns OrgDefinedId,Username,Last Name,First Name', d2.idCols, [0, 1, 2, 3]);
eq('org/user/first/last indices', [d2.orgIdx, d2.userIdx, d2.firstIdx, d2.lastIdx], [0, 1, 3, 2]);
eq('one grade item detected', d2.gradeItems.length, 1);
eq('grade item name strips " Points Grade" suffix',
  d2.gradeItems[0], { index: 4, name: 'Sample Activity 1', header: 'Sample Activity 1 Points Grade' });
eq('End-of-Line Indicator column located', d2.eolIdx, 5);

// ---------------------------------------------------------------------------
console.log('\nD2L per-student parsing + matching');
const d2lStudents = d2.data.filter((r) => !GC.isBlankRow(r)).map((r) => GC.parseD2LStudent(r[d2.firstIdx], r[d2.lastIdx]));
eq('separate first/last joined into raw', d2lStudents[0].raw, 'Alice Apple');
eq('multi-token name tokenised', d2lStudents[6].tokens, ['maria', 'elena', 'garcia', 'lopez']);
{
  const m = GC.autoMatch(doenetStudents, d2lStudents);
  const idxOf = (name) => doenetStudents.findIndex((d) => d.display.toLowerCase() === name.toLowerCase());
  ok('Alice Apple -> high', m[idxOf('Alice Apple')].confidence === 'high');
  ok('erin evans -> high (case-insensitive)', m[idxOf('erin evans')].confidence === 'high');
  const ml = m[idxOf('Maria Lopez')];
  ok('Maria Lopez -> Garcia Lopez (likely)',
    ml.canvasIdx != null && d2lStudents[ml.canvasIdx].raw === 'Maria Elena Garcia Lopez' && ml.confidence === 'likely',
    JSON.stringify(ml));
  ok('Nina Okafor stays unmatched (no D2L counterpart)', m[idxOf('Nina Okafor')].canvasIdx === null);
}

// ---------------------------------------------------------------------------
console.log('\nD2L import build (new item, percent -> 100 pts)');
{
  const m = GC.autoMatch(doenetStudents, d2lStudents);
  const grades = new Map();
  const doenetData = dd.data.filter((x) => !GC.isBlankRow(x));
  d2.data.forEach((r, ri) => {
    const di = m.findIndex((x) => x.canvasIdx === ri);
    if (di >= 0) grades.set(ri, GC.transformScore(doenetData[di][dd.scoreIdx], 'percent', 100));
  });
  const out = GC.buildD2LImport({ d2l: d2, targetName: 'Sample Activity 1', grades, isNew: true });

  eq('header preserves identifier cols + "<name> Points Grade" + End-of-Line',
    out[0], ['OrgDefinedId', 'Username', 'Last Name', 'First Name', 'Sample Activity 1 Points Grade', 'End-of-Line Indicator']);
  ok('no Points Possible row (first data row is a student)', out[1][0] === '3000001');
  ok('every data row ends with the "#" End-of-Line marker',
    out.slice(1).every((r) => r[r.length - 1] === '#'));
  ok('identifier values (incl. #-prefixed username) copied verbatim',
    out[1][0] === '3000001' && out[1][1] === '#aapple');

  function d2lGrade(org) {
    const row = out.find((r) => r[0] === org);
    return row ? row[row.length - 2] : undefined; // last col is End-of-Line "#"
  }
  eq('Alice Apple (3000001) -> Alice Apple score', d2lGrade('3000001'), expectGrade('Alice Apple'));
  eq('Maria (fuzzy, 3000007) -> Maria Lopez score', d2lGrade('3000007'), expectGrade('Maria Lopez'));
  eq('unmatched Test Student (3000009) -> blank', d2lGrade('3000009'), '');

  // New vs existing both use the "<name> Points Grade" header form.
  const outExisting = GC.buildD2LImport({ d2l: d2, targetName: 'Sample Activity 1', grades: new Map(), isNew: false });
  eq('existing item header form', outExisting[0][4], 'Sample Activity 1 Points Grade');

  // Round-trip survives serialise/parse.
  const reparsed = GC.parseCSV(GC.toCSV(out));
  eq('round-trip preserves header', reparsed[0], out[0]);
  ok('round-trip keeps End-of-Line "#"', reparsed.slice(1).every((r) => r[r.length - 1] === '#'));
}

// ---------------------------------------------------------------------------
console.log('\nWrong-file detection (D2L)');
{
  ok('a Canvas file is not a valid D2L export (no First/Last Name cols)',
    GC.detectD2L(GC.parseCSV(canvasText)).firstIdx === -1);
  const d2chk = GC.detectD2L(d2lRows);
  ok('a real D2L file has an identifier + name columns',
    (d2chk.orgIdx >= 0 || d2chk.userIdx >= 0) && d2chk.firstIdx >= 0 && d2chk.lastIdx >= 0);
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

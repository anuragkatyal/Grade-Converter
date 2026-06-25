/*
 * DOM integration test: loads the actual index.html in jsdom, drops the two
 * sample files onto the upload zones, then clicks Download and inspects the CSV
 * the page actually produces. Exercises the UI glue (state, matching, build).
 *   run:  node test/ui.integration.test.mjs   (requires: npm i jsdom)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra ? '  -> ' + extra : '')); }
}

// Build a self-contained HTML: inline doenet-to-lms-csv-tool.js, drop the CDN <script>.
let html = readFileSync(join(root, 'index.html'), 'utf8');
const gcSrc = readFileSync(join(root, 'doenet-to-lms-csv-tool.js'), 'utf8');
html = html.replace(/<script src="https:\/\/cdn[^"]*"><\/script>/, '');
html = html.replace('<script src="doenet-to-lms-csv-tool.js"></script>', '<script>' + gcSrc + '</script>');

const doenetText = readFileSync(join(root, 'From Doenet.csv'), 'utf8');
const canvasText = readFileSync(join(root, 'From Canvas.csv'), 'utf8');
const d2lText = readFileSync(join(root, 'From D2L.csv'), 'utf8');

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
const win = dom.window;
const doc = win.document;

// Capture the CSV the page hands to the browser for download.
let captured = null;
win.Blob = class { constructor(parts) { this._text = parts.join(''); } };
win.URL.createObjectURL = function (b) { captured = b; return 'blob:test'; };
win.URL.revokeObjectURL = function () {};
win.HTMLAnchorElement.prototype.click = function () {}; // no navigation in jsdom

function dropFile(zoneId, name, text) {
  const file = new win.File([text], name, { type: 'text/csv' });
  const ev = new win.Event('drop', { bubbles: true });
  ev.dataTransfer = { files: [file] };
  doc.getElementById(zoneId).dispatchEvent(ev);
}

const wait = (ms) => new Promise((r) => win.setTimeout(r, ms));

(async function run() {
  console.log('\nUI integration (real index.html in jsdom)');

  dropFile('drop-doenet', 'From Doenet.csv', doenetText);
  dropFile('drop-canvas', 'From Canvas.csv', canvasText);

  // FileReader is async; wait until the download button is enabled.
  let tries = 0;
  while (doc.getElementById('download-btn').disabled && tries++ < 50) await wait(20);

  ok('upload zones marked loaded',
    doc.getElementById('drop-doenet').classList.contains('loaded') &&
    doc.getElementById('drop-canvas').classList.contains('loaded'));
  ok('config + match + download cards revealed',
    !doc.getElementById('card-match').classList.contains('hidden') &&
    !doc.getElementById('card-download').classList.contains('hidden'));

  // Default target name should auto-fill from the Doenet activity column.
  ok('new-assignment name auto-filled from Doenet header',
    doc.getElementById('new-name').value === 'Sample Activity 1',
    doc.getElementById('new-name').value);

  // Match table should render one row per (named) Doenet student.
  const rows = doc.querySelectorAll('#match-table tbody tr');
  ok('match table has 13 student rows', rows.length === 13, String(rows.length));

  // There should be at least one "Confirm?" (likely) badge for the fuzzy match.
  const likely = doc.querySelectorAll('#match-table .b-likely').length;
  ok('fuzzy match flagged for confirmation', likely >= 1, String(likely));

  // Trigger download and inspect the produced CSV.
  doc.getElementById('download-btn').click();
  ok('download produced a blob', captured && typeof captured._text === 'string');

  const GC = win.GC;

  // Expected grades are DERIVED from the sample file, not hard-coded, so these
  // checks survive edits to the sample scores (percent mode, pointsPossible 100).
  const dd = GC.detectDoenet(GC.parseCSV(doenetText));
  const doenetRows = dd.data.filter((r) => !GC.isBlankRow(r));
  const doenetStudents = doenetRows.map((r) => GC.doenetName(r[dd.firstIdx], r[dd.lastIdx]));
  function expectGrade(doenetDisplay, mode = 'percent', pp = 100) {
    const k = doenetStudents.findIndex((d) => d.display.toLowerCase() === doenetDisplay.toLowerCase());
    if (k < 0) throw new Error(`no Doenet student named "${doenetDisplay}" in the sample`);
    return GC.transformScore(doenetRows[k][dd.scoreIdx], mode, pp);
  }

  const out = GC.parseCSV(captured._text);
  ok('header row correct',
    JSON.stringify(out[0]) === JSON.stringify(['Student', 'ID', 'SIS Login ID', 'Section', 'Sample Activity 1']),
    JSON.stringify(out[0]));
  ok('points-possible row correct',
    JSON.stringify(out[1]) === JSON.stringify(['Points Possible', '', '', '', '100']),
    JSON.stringify(out[1]));

  function grade(student) {
    const r = out.find((row) => row[0] === student);
    return r ? r[r.length - 1] : undefined;
  }
  ok('Apple, Alice -> Alice Apple score', grade('Apple, Alice') === expectGrade('Alice Apple'), grade('Apple, Alice'));
  ok('Garcia Lopez (fuzzy) -> Maria Lopez score', grade('Garcia Lopez, Maria Elena') === expectGrade('Maria Lopez'), grade('Garcia Lopez, Maria Elena'));
  ok('Cruz, Carlos -> Carlos Cruz score', grade('Cruz, Carlos') === expectGrade('Carlos Cruz'), grade('Cruz, Carlos'));
  ok('unmatched Test Student -> blank', grade('Student, Test') === '', JSON.stringify(grade('Student, Test')));

  // Every Canvas student row is present in the output (8 students + test student).
  const dataRows = out.slice(2).filter((r) => r[0]);
  ok('all canvas students present in output', dataRows.length === 9, String(dataRows.length));

  // Switching to "copy as-is" should change a fractional grade verbatim.
  doc.querySelector('input[name=scale-mode][value=copy]').checked = true;
  doc.querySelector('input[name=scale-mode][value=copy]').dispatchEvent(new win.Event('change'));
  // (demo user=12.5 is unmatched, so pick a matched student & verify the raw score is copied verbatim in copy mode.)
  doc.getElementById('download-btn').click();
  const out2 = GC.parseCSV(captured._text);
  const g2 = (() => { const r = out2.find((row) => row[0] === 'Gomez, Grace'); return r && r[r.length - 1]; })();
  ok('copy mode copies raw score verbatim', g2 === expectGrade('Grace Gomez', 'copy'), g2);

  // Clearing Points Possible blocks the download (a new assignment needs points).
  doc.getElementById('new-points').value = '';
  doc.getElementById('new-points').dispatchEvent(new win.Event('input'));
  ok('blank points blocks download', doc.getElementById('download-btn').disabled === true);
  ok('warning shown for blank points', !doc.getElementById('collision-warn').classList.contains('hidden'));
  doc.getElementById('new-points').value = '100';
  doc.getElementById('new-points').dispatchEvent(new win.Event('input'));
  ok('restoring points re-enables download', doc.getElementById('download-btn').disabled === false);

  // Forcing two Doenet rows onto the same Canvas student surfaces a collision.
  let sels = doc.querySelectorAll('#match-table select.match-sel');
  const cv = sels[0].querySelector('option[value]:not([value="-1"])').value;
  sels[0].value = cv; sels[0].dispatchEvent(new win.Event('change'));
  sels = doc.querySelectorAll('#match-table select.match-sel'); // table was rebuilt
  sels[1].value = cv; sels[1].dispatchEvent(new win.Event('change'));
  ok('collision warning appears and names both students',
    /both map to/.test(doc.getElementById('collision-warn').innerHTML));
  ok('losing row is flagged Overwritten',
    doc.getElementById('match-table').innerHTML.indexOf('Overwritten') >= 0);

  // --- D2L path: flip the toggle, drop the D2L export, inspect the import -----
  console.log('\nUI integration — D2L path');
  const d2lRadio = doc.querySelector('input[name=lms][value=d2l]');
  d2lRadio.checked = true;
  d2lRadio.dispatchEvent(new win.Event('change'));

  ok('toggle re-labels the page for D2L',
    doc.getElementById('page-title').textContent.indexOf('D2L') >= 0);
  ok('downstream cards hidden until the D2L file is uploaded',
    doc.getElementById('card-download').classList.contains('hidden'));

  // Doenet file is still loaded; only the target box was reset. Drop the D2L file.
  dropFile('drop-canvas', 'From D2L.csv', d2lText);
  tries = 0;
  while (doc.getElementById('download-btn').disabled && tries++ < 50) await wait(20);

  // Use percent -> 100 points for a deterministic scaling.
  doc.querySelector('input[name=scale-mode][value=percent]').checked = true;
  doc.querySelector('input[name=scale-mode][value=percent]').dispatchEvent(new win.Event('change'));
  doc.getElementById('new-points').value = '100';
  doc.getElementById('new-points').dispatchEvent(new win.Event('input'));

  doc.getElementById('download-btn').click();
  const dOut = GC.parseCSV(captured._text);
  ok('D2L header row correct',
    JSON.stringify(dOut[0]) === JSON.stringify(['OrgDefinedId', 'Username', 'Last Name', 'First Name', 'Sample Activity 1 Points Grade', 'End-of-Line Indicator']),
    JSON.stringify(dOut[0]));
  ok('no Points Possible row (first data row is a student)', dOut[1][0] === '3000001', JSON.stringify(dOut[1]));
  ok('every data row carries the "#" End-of-Line marker',
    dOut.slice(1).every((r) => r[r.length - 1] === '#'));
  ok('identifier columns preserved verbatim (incl. #username)',
    dOut[1][0] === '3000001' && dOut[1][1] === '#aapple', JSON.stringify(dOut[1].slice(0, 2)));

  function d2lGrade(org) {
    const r = dOut.find((row) => row[0] === org);
    return r ? r[r.length - 2] : undefined; // last col is the End-of-Line "#"
  }
  ok('Alice Apple (3000001) -> 100', d2lGrade('3000001') === '100', d2lGrade('3000001'));
  ok('unmatched Test Student (3000009) -> blank', d2lGrade('3000009') === '', JSON.stringify(d2lGrade('3000009')));
  ok('import note mentions D2L import',
    /Grades\s*→\s*Import/.test(doc.getElementById('import-note').innerHTML));

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();

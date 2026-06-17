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

// Build a self-contained HTML: inline grade-converter.js, drop the CDN <script>.
let html = readFileSync(join(root, 'index.html'), 'utf8');
const gcSrc = readFileSync(join(root, 'grade-converter.js'), 'utf8');
html = html.replace(/<script src="https:\/\/cdn[^"]*"><\/script>/, '');
html = html.replace('<script src="grade-converter.js"></script>', '<script>' + gcSrc + '</script>');

const doenetText = readFileSync(join(root, 'From Doenet.csv'), 'utf8');
const canvasText = readFileSync(join(root, 'From Canvas.csv'), 'utf8');

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
  ok('Apple, Alice -> 100', grade('Apple, Alice') === '100', grade('Apple, Alice'));
  ok('Garcia Lopez (fuzzy) -> 100', grade('Garcia Lopez, Maria Elena') === '100', grade('Garcia Lopez, Maria Elena'));
  ok('Cruz, Carlos -> 100', grade('Cruz, Carlos') === '100', grade('Cruz, Carlos'));
  ok('unmatched Test Student -> blank', grade('Student, Test') === '', JSON.stringify(grade('Student, Test')));

  // Every Canvas student row is present in the output (8 students + test student).
  const dataRows = out.slice(2).filter((r) => r[0]);
  ok('all canvas students present in output', dataRows.length === 9, String(dataRows.length));

  // Switching to "copy as-is" should change a fractional grade verbatim.
  doc.querySelector('input[name=scale-mode][value=copy]').checked = true;
  doc.querySelector('input[name=scale-mode][value=copy]').dispatchEvent(new win.Event('change'));
  // (demo user=12.5 is unmatched, so pick a matched student & verify 100 stays 100 in copy mode.)
  doc.getElementById('download-btn').click();
  const out2 = GC.parseCSV(captured._text);
  const g2 = (() => { const r = out2.find((row) => row[0] === 'Gomez, Grace'); return r && r[r.length - 1]; })();
  ok('copy mode keeps 100 as 100', g2 === '100', g2);

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

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();

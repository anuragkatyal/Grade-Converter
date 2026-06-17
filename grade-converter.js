/*
 * grade-converter.js — core logic for transferring Doenet grades into a Canvas import file.
 *
 * Pure, dependency-free, and runnable in both the browser (window.GC) and Node
 * (module.exports) so the same code that powers the page is covered by the test
 * harness in test/. All functions operate on plain arrays/strings — file reading
 * and DOM wiring live in index.html.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GC = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // CSV parsing / serialising (RFC 4180-ish: quoted fields, "" escapes, CRLF,
  // embedded newlines, leading BOM). Returns/consumes string[][].
  // ---------------------------------------------------------------------------
  function parseCSV(text) {
    if (text == null) return [];
    text = String(text);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const n = text.length;
    let i = 0;
    while (i < n) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    row.push(field);
    rows.push(row);
    // Drop a trailing blank row produced by a file-final newline.
    if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
      rows.pop();
    }
    return rows;
  }

  function csvCell(v) {
    v = v == null ? '' : String(v);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function toCSV(rows) {
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  // ---------------------------------------------------------------------------
  // Name normalisation & similarity
  // ---------------------------------------------------------------------------
  function normalizeName(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')                     // punctuation -> space
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenize(s) {
    const n = normalizeName(s);
    return n ? n.split(' ') : [];
  }

  // Token-set similarity in [0,1]: Jaccard overlap, with a bonus when one name's
  // tokens are a subset of the other's (handles e.g. "Maria Lopez" vs the Canvas
  // "Garcia Lopez, Maria Elena").
  function similarity(dTokens, cTokens) {
    const D = new Set(dTokens);
    const C = new Set(cTokens);
    if (!D.size || !C.size) return 0;
    let inter = 0;
    D.forEach(function (t) { if (C.has(t)) inter++; });
    if (!inter) return 0;
    const union = new Set([].concat(dTokens, cTokens)).size;
    let score = inter / union;
    const dSubset = [...D].every(function (t) { return C.has(t); });
    const cSubset = [...C].every(function (t) { return D.has(t); });
    // Only reward a subset relationship when more than one token is shared; a
    // single shared token (e.g. a lone surname) must not be inflated toward a match.
    if ((dSubset || cSubset) && Math.min(D.size, C.size) > 1) score = Math.min(1, score + 0.2);
    return score;
  }

  // True iff two names have the same set of tokens (order-independent).
  function tokenSetsEqual(a, b) {
    const A = new Set(a), B = new Set(b);
    if (!A.size || A.size !== B.size) return false;
    let ok = true;
    A.forEach(function (t) { if (!B.has(t)) ok = false; });
    return ok;
  }

  // Number of tokens shared between two names.
  function sharedTokenCount(a, b) {
    const B = new Set(b);
    let n = 0;
    new Set(a).forEach(function (t) { if (B.has(t)) n++; });
    return n;
  }

  // "Last, First Middle" -> tokens + display pieces. Canvas Student column.
  function parseCanvasStudent(cell) {
    const raw = String(cell == null ? '' : cell).trim();
    let last = '', first = raw;
    const ci = raw.indexOf(',');
    if (ci >= 0) { last = raw.slice(0, ci); first = raw.slice(ci + 1); }
    return {
      raw: raw,
      last: last.trim(),
      first: first.trim(),
      tokens: tokenize(last + ' ' + first),
    };
  }

  function doenetName(firstCell, lastCell, fullCell) {
    let first = String(firstCell == null ? '' : firstCell).trim();
    let last = String(lastCell == null ? '' : lastCell).trim();
    let display;
    if (fullCell != null && first === '' && last === '') {
      display = String(fullCell).trim().replace(/\s+/g, ' ');
      return { first: '', last: '', tokens: tokenize(fullCell), display: display };
    }
    display = (first + ' ' + last).trim().replace(/\s+/g, ' ');
    return { first: first, last: last, tokens: tokenize(first + ' ' + last), display: display };
  }

  // ---------------------------------------------------------------------------
  // Auto-detection of column roles
  // ---------------------------------------------------------------------------
  function detectDoenet(rows) {
    if (!rows.length) return { headers: [], data: [], firstIdx: -1, lastIdx: -1, idIdx: -1, fullIdx: -1, scoreIdx: -1, scoreHeader: '' };
    const headers = rows[0].map(function (h) { return String(h).trim(); });
    const data = rows.slice(1);
    const lower = headers.map(function (h) { return h.toLowerCase(); });

    const matchHeader = function (cands) { return lower.findIndex(function (h) { return cands.indexOf(h) >= 0; }); };
    let firstIdx = matchHeader(['first name', 'firstname', 'first', 'given name']);
    let lastIdx = matchHeader(['last name', 'lastname', 'last', 'surname', 'family name']);
    let idIdx = lower.findIndex(function (h) { return h.indexOf('student id') >= 0 || h === 'id' || h === 'userid' || h === 'user id'; });
    let fullIdx = -1;
    if (firstIdx < 0 && lastIdx < 0) {
      fullIdx = lower.findIndex(function (h) { return h.indexOf('name') >= 0 || h.indexOf('student') >= 0; });
    }

    // Score column: prefer the right-most column (excluding name/id) that holds
    // numeric data — Doenet puts the activity score in the last column.
    let scoreIdx = -1;
    for (let j = headers.length - 1; j >= 0; j--) {
      if (j === firstIdx || j === lastIdx || j === idIdx || j === fullIdx) continue;
      const numeric = data.some(function (r) {
        const v = r[j];
        return v != null && String(v).trim() !== '' && !isNaN(parseFloat(v));
      });
      if (numeric) { scoreIdx = j; break; }
    }
    return {
      headers: headers, data: data,
      firstIdx: firstIdx, lastIdx: lastIdx, idIdx: idIdx, fullIdx: fullIdx,
      scoreIdx: scoreIdx, scoreHeader: scoreIdx >= 0 ? headers[scoreIdx] : '',
    };
  }

  function detectCanvas(rows) {
    if (!rows.length) return { headers: [], data: [], assignments: [], idCols: [], pointsPossibleRow: null, studentIdx: 0, idIdx: -1, firstAssignIdx: 0 };
    const headers = rows[0].map(function (h) { return String(h).trim(); });

    // The "Points Possible" row sits just under the header.
    let ppIdx = -1;
    for (let i = 1; i < Math.min(rows.length, 6); i++) {
      if (String((rows[i] || [])[0]).trim().toLowerCase() === 'points possible') { ppIdx = i; break; }
    }
    const pointsPossibleRow = ppIdx >= 0 ? rows[ppIdx] : null;
    const dataStart = ppIdx >= 0 ? ppIdx + 1 : 1;
    const data = rows.slice(dataStart);

    // Assignment columns carry a "(numericId)" suffix; read-only roll-ups don't.
    const assignments = [];
    headers.forEach(function (h, idx) {
      const m = h.match(/^(.*?)\s*\((\d+)\)\s*$/);
      if (m) {
        assignments.push({
          index: idx, name: m[1].trim(), id: m[2], header: h,
          pointsPossible: pointsPossibleRow ? String(pointsPossibleRow[idx] == null ? '' : pointsPossibleRow[idx]).trim() : '',
        });
      }
    });

    const firstAssignIdx = assignments.length ? assignments[0].index : headers.length;
    const idCols = [];
    for (let j = 0; j < firstAssignIdx; j++) idCols.push(j);

    const lower = headers.map(function (h) { return h.toLowerCase(); });
    let studentIdx = lower.indexOf('student');
    if (studentIdx < 0) studentIdx = 0;
    const idIdx = lower.indexOf('id');

    return {
      headers: headers, data: data, assignments: assignments, idCols: idCols,
      pointsPossibleRow: pointsPossibleRow, studentIdx: studentIdx, idIdx: idIdx,
      firstAssignIdx: firstAssignIdx,
    };
  }

  function isBlankRow(r) {
    return !r || r.every(function (c) { return String(c == null ? '' : c).trim() === ''; });
  }

  // ---------------------------------------------------------------------------
  // Matching
  // ---------------------------------------------------------------------------
  // doenet/canvas: arrays of objects each having a `tokens` array.
  // Returns one entry per doenet student: { canvasIdx, score, confidence }.
  // Greedy by descending similarity; each Canvas student used at most once.
  const HIGH = 0.85;   // (legacy reference) strong score; confidence now keys off exact token match
  const LIKELY = 0.45; // minimum score to auto-suggest a (confirmable) match

  function autoMatch(doenet, canvas) {
    const pairs = [];
    for (let i = 0; i < doenet.length; i++) {
      const dt = doenet[i].tokens;
      if (!dt || !dt.length) continue;
      for (let j = 0; j < canvas.length; j++) {
        const ct = canvas[j].tokens;
        if (!ct || !ct.length) continue;
        const s = similarity(dt, ct);
        if (s > 0) pairs.push({ i: i, j: j, s: s, shared: sharedTokenCount(dt, ct), equal: tokenSetsEqual(dt, ct) });
      }
    }
    // Stable-ish ordering: highest score first, then by index for determinism.
    pairs.sort(function (a, b) { return b.s - a.s || a.i - b.i || a.j - b.j; });

    const dUsed = new Array(doenet.length).fill(false);
    const cUsed = new Array(canvas.length).fill(false);
    const result = doenet.map(function () { return { canvasIdx: null, score: 0, confidence: 'none' }; });

    pairs.forEach(function (p) {
      if (dUsed[p.i] || cUsed[p.j]) return;
      // Require either an exact (order-independent) full-name match or at least two
      // shared name tokens — a single shared token is too weak to auto-suggest.
      if (!(p.equal || p.shared >= 2) || p.s < LIKELY) return;
      dUsed[p.i] = true; cUsed[p.j] = true;
      // "high" only for an exact token-set match; partial/subset matches are
      // "likely" so the UI flags them for the instructor to confirm.
      result[p.i] = { canvasIdx: p.j, score: p.s, confidence: p.equal ? 'high' : 'likely' };
    });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Grade transform
  // ---------------------------------------------------------------------------
  // mode: 'percent' (value is 0..100, scale to pointsPossible) or 'copy' (as-is).
  // Returns '' for anything that isn't a clean number — we never silently strip
  // commas/locale separators (which would fabricate a 10x/1000x-wrong grade), and
  // percent mode returns '' (rather than 0) when points possible is missing/<=0.
  const round4 = function (n) { return Math.round(n * 10000) / 10000; };
  function transformScore(raw, mode, pointsPossible) {
    if (raw == null) return '';
    const s = String(raw).trim().replace(/%$/, '').trim();
    if (s === '') return '';
    if (!/^-?\d+(\.\d+)?$/.test(s)) return ''; // not a plain numeric literal
    const v = parseFloat(s);
    if (isNaN(v)) return '';
    if (mode === 'percent') {
      const pp = parseFloat(pointsPossible);
      if (!(pp > 0)) return ''; // unknown/zero points possible -> blank, never zero everyone
      return String(round4((v / 100) * pp));
    }
    return String(round4(v));
  }

  // ---------------------------------------------------------------------------
  // Canvas import builder
  // ---------------------------------------------------------------------------
  // opts: { canvas, targetHeader, targetPointsPossible, grades: Map<dataRowIndex,value>, isNew }
  function buildCanvasImport(opts) {
    const canvas = opts.canvas;
    const idCols = canvas.idCols.length ? canvas.idCols : canvas.headers.map(function (_, j) { return j; });
    const grades = opts.grades || new Map();

    // Canvas reads a "Name (123)" header as the EXISTING assignment with id 123.
    // For a new assignment, rewrite a trailing "(123)" to "[123]" so it can't be
    // mistaken for an id and a fresh column is created instead.
    let header = opts.targetHeader == null ? '' : String(opts.targetHeader);
    if (opts.isNew && /\(\s*\d+\s*\)\s*$/.test(header)) {
      header = header.replace(/\(\s*(\d+)\s*\)(\s*)$/, '[$1]$2');
    }

    const out = [];
    out.push(idCols.map(function (j) { return canvas.headers[j]; }).concat([header]));

    const ppRow = idCols.map(function (_, k) { return k === 0 ? 'Points Possible' : ''; });
    ppRow.push(String(opts.targetPointsPossible == null ? '' : opts.targetPointsPossible));
    out.push(ppRow);

    canvas.data.forEach(function (r, ri) {
      if (isBlankRow(r)) return;
      const idVals = idCols.map(function (j) { return r[j] == null ? '' : r[j]; });
      const g = grades.has(ri) ? grades.get(ri) : '';
      out.push(idVals.concat([g]));
    });
    return out;
  }

  return {
    parseCSV: parseCSV,
    toCSV: toCSV,
    csvCell: csvCell,
    normalizeName: normalizeName,
    tokenize: tokenize,
    similarity: similarity,
    parseCanvasStudent: parseCanvasStudent,
    doenetName: doenetName,
    detectDoenet: detectDoenet,
    detectCanvas: detectCanvas,
    isBlankRow: isBlankRow,
    similarityHelpers: { tokenSetsEqual: tokenSetsEqual, sharedTokenCount: sharedTokenCount },
    autoMatch: autoMatch,
    transformScore: transformScore,
    buildCanvasImport: buildCanvasImport,
    HIGH: HIGH,
    LIKELY: LIKELY,
  };
});

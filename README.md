# Grade-Converter

[![CI](https://github.com/anuragkatyal/Grade-Converter/actions/workflows/ci.yml/badge.svg)](https://github.com/anuragkatyal/Grade-Converter/actions/workflows/ci.yml)

A small, **100% client-side** web tool that transfers grades from a
[Doenet](https://beta.doenet.org) activity export into a CSV you can import
directly into the **Canvas** gradebook.

You upload two files, the tool matches students by name, and you download a
Canvas-ready CSV. **Nothing is uploaded to any server** — all parsing and
matching happens in your browser, so student data never leaves your machine.

➡️ **Live tool:** https://anuragkatyal.github.io/Grade-Converter/

---

## What it does

1. **Upload** a Doenet activity export and a Canvas gradebook export (`.csv`, or
   `.xlsx` when you're online).
2. **Confirm columns** — the tool auto-detects the Doenet name and score columns;
   you can override them.
3. **Pick the Canvas target** — create a brand-new assignment column, or fill an
   assignment that already exists in your export. Choose whether the Doenet score
   is a **percentage** (scaled to the assignment's points possible) or copied
   **as-is**.
4. **Review matches** — students are matched by name with fuzzy handling for
   reordered/partial/lower-case names. Best-guess matches are flagged for you to
   confirm, and you can fix any match (or skip a student) from a dropdown.
5. **Download** the Canvas import CSV and upload it in Canvas.

### Why name matching (and not ID)?

Doenet's "Student ID" is an opaque, internal Doenet identifier (a random-looking
string) that has no relationship to Canvas's user ID or SIS
login. The only field the two exports share is the student's **name**, so the
tool matches on name and lets you confirm/correct anything uncertain. Canvas
itself then matches the import to students by the hidden numeric `ID` column,
which is preserved from your Canvas export.

---

## File formats it expects

**Doenet export** — one header row, then one row per student:

| First name | Last name | Student ID  | _Activity name_ |
|------------|-----------|-------------|-----------------|
| Alice      | Apple     | D0001       | 100             |

The activity-score column is treated as a percentage (0–100) by default. (The
"Student ID" is an opaque Doenet identifier and is **not** used for matching.)

**Canvas export** — standard gradebook export: a header row, a `Points Possible`
row, then students. Identifier columns (`Student`, `ID`, `SIS Login ID`,
`Section`) come first, followed by assignment columns whose headers end in
`(numeric-id)`, e.g. `Test 1 (1000002)`.

The tool only writes the identifier columns plus your chosen grade column to the
output, so importing it changes **only** that one assignment. Students with no
Doenet match are left blank (Canvas leaves blanks unchanged).

Two sample files — [`From Doenet.csv`](From%20Doenet.csv) and
[`From Canvas.csv`](From%20Canvas.csv) — are included so the test suite can run
against realistic data. **They contain entirely fabricated names and IDs** (no
real student data), so they are safe to publish. If you swap in your own real
export to test locally, do **not** commit it — keep student data off the public
site.

---

## How to import the result into Canvas

1. In your Canvas course, go to **Grades**.
2. Click the **Import** (cloud-up) button — or, for a single assignment, use the
   assignment column's **⋮ → Re-Upload Scores**.
3. Choose the downloaded `Canvas Import - … .csv`.
4. **Review the preview Canvas shows you** and confirm. If you created a new
   assignment, Canvas will ask you to confirm the new column and its points.

---

## Deploying (GitHub Pages)

This repo is plain static files — no build step.

1. Push to GitHub (already at `anuragkatyal/Grade-Converter`).
2. **Settings → Pages → Build and deployment → Source:** *Deploy from a branch*.
3. Branch: `main`, folder: `/ (root)`. Save.
4. After a minute the tool is live at
   `https://anuragkatyal.github.io/Grade-Converter/`.

The only external dependency is [SheetJS](https://sheetjs.com) (loaded from a CDN)
and it is used **only** to read `.xlsx` uploads — CSV uploads work fully offline.

---

## Project layout

| File | Purpose |
|------|---------|
| `index.html` | The whole UI (HTML + CSS + glue JS). |
| `grade-converter.js` | Dependency-free core logic — CSV parse/serialise, name matching, score scaling, Canvas-import builder. Runs in the browser **and** Node. |
| `test/grade-converter.test.mjs` | Unit tests for the core logic, run against the real sample files. |
| `test/ui.integration.test.mjs` | Loads `index.html` in jsdom, simulates the two uploads, and checks the downloaded CSV. |

## Running the tests

```bash
npm install      # dev-only: jsdom, for the integration test
npm test
```

The unit tests need no dependencies (`node test/grade-converter.test.mjs`); only
the DOM integration test requires `jsdom`.

## License

MIT

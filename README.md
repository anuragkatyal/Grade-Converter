# Grade-Converter

[![CI](https://github.com/anuragkatyal/Grade-Converter/actions/workflows/ci.yml/badge.svg)](https://github.com/anuragkatyal/Grade-Converter/actions/workflows/ci.yml)

A small, **100% client-side** web tool that transfers grades from a
[Doenet](https://beta.doenet.org) activity export into a CSV you can import
directly into the **Canvas** *or* **D2L / Brightspace** gradebook.

You pick your gradebook, upload two files, the tool matches students by name, and
you download an import-ready CSV. **Nothing is uploaded to any server** — all
parsing and matching happens in your browser, so student data never leaves your
machine.

➡️ **Live tool:** https://anuragkatyal.github.io/Grade-Converter/

---

## What it does

1. **Choose your gradebook** — Canvas or D2L / Brightspace.
2. **Upload** a Doenet activity export and your gradebook export, both as `.csv`
   (if you opened them in Excel, save back to CSV first).
3. **Confirm columns** — the tool auto-detects the Doenet name and score columns;
   you can override them.
4. **Pick the target** — create a brand-new column, or fill a column/grade item
   that already exists in your export. Choose whether the Doenet score is a
   **percentage** (scaled to the points possible) or copied **as-is**.
5. **Review matches** — students are matched by name with fuzzy handling for
   reordered/partial/lower-case names. Best-guess matches are flagged for you to
   confirm, and you can fix any match (or skip a student) from a dropdown.
6. **Download** the import CSV and upload it in your gradebook.

### Why name matching (and not Doenet's ID)?

Doenet's "Student ID" is an opaque, internal Doenet identifier (a random-looking
string) that has no relationship to your LMS's user ID, SIS login, username, or
Org Defined ID. The only field the exports share is the student's **name**, so
the tool matches on name and lets you confirm/correct anything uncertain. Your
LMS then re-matches the import to students by its own identifier columns —
preserved **verbatim** from your export — so the round-trip is exact:

- **Canvas** matches by the hidden numeric `ID` column.
- **D2L / Brightspace** matches by the `OrgDefinedId` / `Username` columns.

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

**D2L / Brightspace export** — *Grades → Export*: a single header row (no
`Points Possible` row), then students. When exporting, make sure to include
**First Name**, **Last Name**, and an identifier (**Username** and/or **Org
Defined ID**) so the tool can match by name and preserve the identifier. Grade
items appear as `<Item Name> Points Grade` columns, and the file ends with an
`End-of-Line Indicator` column (a `#` in every row). The output reproduces this
format, including the `End-of-Line Indicator`.

> **D2L points possible.** A D2L export does **not** carry each item's max
> points, so the tool asks you to enter it. For percentage scaling to be correct,
> the value you enter must match the grade item's **Max Points** in D2L. If you
> create a new grade item on import, tick *“Create new grade item when an
> unrecognized item is referenced”* in D2L's import wizard and set its max points
> to the same value.

The tool only writes the identifier columns plus your chosen grade column (and,
for D2L, the `End-of-Line Indicator`) to the output, so importing it changes
**only** that one column. Students with no Doenet match are left blank (both
Canvas and D2L leave blanks unchanged).

Three sample files — [`From Doenet.csv`](From%20Doenet.csv),
[`From Canvas.csv`](From%20Canvas.csv), and [`From D2L.csv`](From%20D2L.csv) —
are included so the test suite can run against realistic data. **They contain
entirely fabricated names and IDs** (no real student data), so they are safe to
publish. If you swap in your own real export to test locally, do **not** commit
it — keep student data off the public site.

---

## How to import the result

**Canvas**

1. In your Canvas course, go to **Grades**.
2. Click the **Import** (cloud-up) button — or, for a single assignment, use the
   assignment column's **⋮ → Re-Upload Scores**.
3. Choose the downloaded `Canvas Import - … .csv`.
4. **Review the preview Canvas shows you** and confirm. If you created a new
   assignment, Canvas will ask you to confirm the new column and its points.

**D2L / Brightspace**

1. In your course, go to **Grades → Import**.
2. Choose the downloaded `D2L Import - … .csv`.
3. If you created a new grade item, tick *“Create new grade item when an
   unrecognized item is referenced”* and set its max points to match.
4. **Review the preview** and confirm.

---

## Deploying (GitHub Pages)

This repo is plain static files — no build step.

1. Push to GitHub (already at `anuragkatyal/Grade-Converter`).
2. **Settings → Pages → Build and deployment → Source:** *Deploy from a branch*.
3. Branch: `main`, folder: `/ (root)`. Save.
4. After a minute the tool is live at
   `https://anuragkatyal.github.io/Grade-Converter/`.

There are **no external dependencies** — no CDN scripts and no build step — so
the tool works fully offline once the page has loaded.

---

## Project layout

| File | Purpose |
|------|---------|
| `index.html` | The whole UI (HTML + CSS + glue JS), including the Canvas/D2L toggle and per-LMS adapters. |
| `grade-converter.js` | Dependency-free core logic — CSV parse/serialise, name matching, score scaling, and the Canvas **and** D2L import builders. Runs in the browser **and** Node. |
| `From Doenet.csv` / `From Canvas.csv` / `From D2L.csv` | Synthetic sample exports (fabricated data) used by the tests. |
| `test/grade-converter.test.mjs` | Unit tests for the core logic, run against the real sample files. |
| `test/ui.integration.test.mjs` | Loads `index.html` in jsdom, simulates the uploads for both the Canvas and D2L paths, and checks the downloaded CSV. |

## Running the tests

```bash
npm install      # dev-only: jsdom, for the integration test
npm test
```

The unit tests need no dependencies (`node test/grade-converter.test.mjs`); only
the DOM integration test requires `jsdom`.

## License

MIT

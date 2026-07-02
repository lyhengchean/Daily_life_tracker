# Daily Journal — Build Log

A personal daily journal / note-taking app. Vanilla HTML/CSS/JS frontend, Google
Apps Script backend, Google Sheets as the database. This log covers the build
from the initial request through every fix and feature added since.

---

## 1. Initial build

**Requested:** a full-stack journal with a dashboard (recent entries, stats,
streak), a new-entry form (date, title, content, mood emoji, tags, optional
location/weather), a searchable/filterable entries list, view/edit/delete,
responsive layout, and dark/light mode — plus setup instructions and security
notes, treated as production-ready for personal use.

**Delivered three files:**

- **`index.html`** — single-file app at the time (HTML+CSS+JS together).
  Design direction deliberately avoided the generic "cream background + serif
  headings + terracotta accent" AI-template look. Instead: an ink/amber/mist
  color system ("Daylight" light theme, "Nightfall" dark theme), a three-role
  type system (Newsreader italic for the greeting only, Inter for UI, IBM Plex
  Mono for dates/numbers), and a signature visual — a small arc in the
  dashboard hero that tracks the actual time of day (sun by day, resting moon
  at night), built with `path.getPointAtLength()`.
- **`Code.gs`** — a single `doPost(e)` entry point routes every operation
  (`list`, `create`, `update`, `delete`) via an `action` field. This is a
  deliberate workaround, not an oversight: Apps Script web apps can't respond
  to CORS preflight (`OPTIONS`) requests, so the frontend sends its payload as
  `text/plain` to keep every request classified as a CORS "simple request,"
  which skips preflight entirely. The sheet's data columns were set to
  plain-text number format to guard against formula/CSV injection. A shared
  `API_KEY` string, checked on every request, was added as a low-cost
  trip-wire against automated scanners (explicitly documented as *not* real
  security — the deployed URL itself is the actual secret).
- **`README.md`** — six-step setup guide (create Sheet → add script → run
  setup → deploy → connect frontend → open), a redeployment note (Apps Script
  deployments are versioned; editing `Code.gs` alone doesn't update a live
  URL), security notes, recommended improvements, and a troubleshooting table.

All code was syntax-checked (`node --check`) and cross-referenced (every
`getElementById` target confirmed to exist in the HTML, no duplicate IDs, tags
balanced) before delivery.

---

## 2. Fix: sheet resolution error on first run

**Symptom:** running `setupSheet()` threw
`TypeError: Cannot read properties of null (reading 'getSheetByName')`.

**Root cause:** `Code.gs` used `SpreadsheetApp.getActiveSpreadsheet()`, which
only reliably resolves when a script runs interactively inside a live,
UI-connected Sheets session. It returns `null` both when a function is run
directly from the standalone Apps Script editor *and* — more seriously —
during real `doPost`/`doGet` web app calls, which this project relies on for
every single operation. This would have broken the live app, not just the
one-time setup function.

**Fix:** added a required `SHEET_ID` constant and a `getSpreadsheet()` helper
using `SpreadsheetApp.openById(SHEET_ID)`, which resolves identically in every
execution context. `getSheet()` was updated to use it, throwing a clear,
actionable error if `SHEET_ID` is left as the placeholder. `README.md` step 2
was rewritten to have the user copy their Sheet's ID from its URL before
pasting in the script, and the troubleshooting table was updated to match.

---

## 3. Fix: "Invalid Date" on entry cards

**Symptom:** after deploying and creating a real entry, its date displayed as
the literal text "INVALID DATE" on the dashboard.

**Root cause:** Google Sheets was silently auto-converting the
`"YYYY-MM-DD"`-looking date string into an actual Date-typed cell — despite
the column being formatted as plain text. When Apps Script read that cell
back, `getValues()` returned a real JS `Date` object instead of the original
string, and `JSON.stringify()` serializes any `Date` via `.toISOString()`,
turning it into something like `"2026-07-01T00:00:00.000Z"`. The frontend's
custom date parser (`dateStr.split('-')`) choked on the time portion, producing
a JS `Invalid Date`, which `toLocaleDateString()` renders as the literal
string `"Invalid Date"` (shown uppercase via CSS `text-transform`).

**Fix:** rather than fight Sheets' auto-conversion, `rowToEntry()` in
`Code.gs` now normalizes on the way *out*: `normalizeDateString()` checks if
the value is a `Date` instance and, if so, reformats it back to
`"YYYY-MM-DD"` using `Utilities.formatDate()` with the spreadsheet's own
timezone (`getJournalTimeZone()`, cached per request to avoid redundant
lookups when listing many rows) — so the date can never shift by a day
regardless of Apps Script's default project timezone. This runs on every
read, so it fixed the already-saved entry retroactively, with no data
migration needed.

---

## 4. Fix: stale data across devices

**Symptom:** an entry added on a phone didn't appear on an already-open
desktop tab without a manual page reload.

**Fix:** added a distinct "quiet" refresh path alongside the existing one:

- `silentRefresh()` — re-fetches entries with no loading spinner and no error
  toast (a background refresh the user didn't ask for shouldn't interrupt
  them); it also refreshes the greeting and day-arc position so a long-lived
  tab doesn't go stale on those either. Skips entirely if a modal is open, so
  it never swaps entries out from under an active edit.
- Wired to `visibilitychange`, `window.addEventListener('focus', …)`, and a
  60-second `setInterval` that only fires while the tab is visible.
- A concurrency guard (`isRefreshing`) prevents overlapping calls when focus
  and visibility events fire together.
- Added a manual 🔄 refresh button in the header (uses the original,
  non-silent `loadEntries()`, so it does show feedback — a spin animation and
  disabled state while in flight).

---

## 5. Restructure: split into HTML / CSS / JS

**Requested:** separate the single `index.html` into three files, done
without unnecessary token spend.

**Approach:** rather than regenerating ~60KB of markup/styling/logic through
the model, the existing on-disk file (already carrying the user's real
deployed Apps Script URL, patched in from their pasted copy first) was split
programmatically with a Python script: the `<style>` block extracted verbatim
to `styles.css`, the `<script>` block extracted verbatim to `script.js`, and
`index.html` rewritten to reference both via `<link rel="stylesheet">` and
`<script src="script.js">`. Verified with `node --check` and an ID
cross-reference after the split. Byte-identical content, just relocated —
kept side by side in the same folder, since `index.html` links the other two
by relative path.

---

## 6. Fix: tag chips barely visible in dark mode

**Reported with:** a screenshot of an empty-looking tag field, alongside a
screenshot of the Google Sheet proving tags ("Work", "Develop") were in fact
being saved correctly.

**Investigation:** traced the full render path — entry cards, the view
modal, and the edit form's `renderTagChips()` — and the logic was correct on
paper. The concrete, verifiable issue found instead: in dark mode,
`.tag-chip`'s background (`--secondary-soft: #232C36`) sat only 6–11 points
per channel away from the card background (`--surface: #1D212B`) — a chip
would render but be very hard to distinguish from its surroundings,
especially in a compressed screenshot.

**Fix:** added `border: 1px solid var(--secondary)` to `.tag-chip` in
`styles.css`, so chips read as clearly defined pills regardless of subtle
background contrast, in either theme. Flagged honestly at the time as a
plausible but not 100%-confirmed root cause, pending confirmation.

---

## 7. Feature: tag autocomplete

**Requested:** tags already used elsewhere in the sheet should be available
when adding a new tag, without being able to overwrite tags already on the
current entry.

**Note on the existing behavior:** the "can't overwrite" half was already
correct — `openEditModal()` loads an entry's saved tags into `state.tags`
before rendering chips, and `addTag()` only ever pushes onto that array, never
replaces it. The actual gap was suggestions *across* entries.

**Fix:** added a native `<datalist id="tagSuggestions">` wired to `#tagInput`
via its `list` attribute — browser-handled autocomplete UI, no custom
dropdown to build or maintain. `populateTagSuggestions()` aggregates every
unique tag across `state.entries`, excluding ones already on the entry being
edited, and is called from inside `renderTagChips()` so the suggestion list
stays in sync with every add/remove. Selecting a suggestion only fills the
text box — the existing Enter/comma/blur flow still governs actually adding a
tag, so the assist can't accidentally short-circuit into adding something
prematurely.

---

## Current file set

| File | Role |
|---|---|
| `index.html` | Markup only; links the two files below |
| `styles.css` | All styling (design tokens, layout, components, themes) |
| `script.js` | All application logic |
| `Code.gs` | Apps Script backend — paste into the Apps Script editor |
| `README.md` | Setup guide, security notes, troubleshooting |

## Known gap

`README.md`'s file table still describes the pre-split, single-`index.html`
layout — it hasn't been updated to mention `styles.css`/`script.js` as
separate files. Worth a pass before treating the README as fully current.
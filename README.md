# Daily Journal — Setup Guide

A small, personal daily journal backed by a Google Sheet. Pure HTML/CSS/JS on the
front end, Google Apps Script on the back end, no build tools, no framework, nothing
to install.

**Files**

| File | What it is |
|---|---|
| `index.html` | The entire app — frontend markup, styling, and logic in one file |
| `Code.gs` | The Apps Script backend — paste this into your Apps Script project |
| `README.md` | This guide |

Setup is six steps and takes about 10 minutes.

---

## 1. Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a **blank spreadsheet**.
2. Rename it to something like **"Daily Journal Database"** (top-left title).
3. That's it — you do *not* need to add any columns or headers yourself. The script
   creates its own `Entries` sheet with the right headers the first time it runs.

## 2. Add the Apps Script backend

1. Copy your Sheet's **ID** from its URL — the long string between `/d/` and
   `/edit`:
   ```
   https://docs.google.com/spreadsheets/d/1a2B3cD4EfGhIjKlMnOpQrStUvWxYz/edit
                                          └──────────── this part ────────────┘
   ```
2. In the Sheet, go to **Extensions → Apps Script**. This opens the script editor
   (any Apps Script project works — see the note below on why this no longer has
   to be strictly container-bound).
3. Delete the placeholder `function myFunction() {}` code in `Code.gs`.
4. Paste in the entire contents of the `Code.gs` file provided.
5. Near the top of the file, find and fill in **both** of these:
   ```js
   const SHEET_ID = 'PASTE_YOUR_SHEET_ID_HERE';   // paste the ID from step 1
   const API_KEY = 'my-journal-secret-2026';       // change to your own random string
   ```
   The `API_KEY` string also has to be pasted into `index.html` in step 5 below —
   keep the tab open, or copy it somewhere.
6. Click the **save icon** (or Ctrl/Cmd+S). Name the project, e.g. "Daily Journal API".

   > **Why a pasted ID instead of "just use the active sheet"?** An earlier version
   > of this backend used `SpreadsheetApp.getActiveSpreadsheet()`, which only works
   > reliably when a script is run interactively from inside an open Sheet. It
   > returns `null` — and throws exactly the error you may have hit if you tested
   > this already — both when running a function directly from the script editor
   > and, critically, during real `doPost` web app calls. Using the Sheet's ID
   > directly works the same way in every context, so it's the more reliable
   > choice for a script that's going to run as a web app.

## 3. Run setup once

1. In the function dropdown at the top of the editor (next to the ▷ Run button),
   select **`setupSheet`**.
2. Click **Run**.
3. Google will ask you to authorize the script — this is expected, since it's your
   own personal script and Google can't "verify" it the way it does published apps.
   Click **Continue**, choose your Google account, then on the "Google hasn't
   verified this app" screen click **Advanced** → **Go to [project name] (unsafe)**
   → **Allow**. This is safe: it's your own script running only in your own account.
4. Once it finishes, check **View → Logs** (or `Ctrl+Enter`) — you should see
   `Setup complete. "Entries" sheet is ready with 0 existing entries.` A new
   **Entries** tab now exists in your spreadsheet with the header row already in place.

   > If you see `Set SHEET_ID at the top of Code.gs to your spreadsheet ID first`
   > instead, go back to step 2 — `SHEET_ID` still has the placeholder text in it.

## 4. Deploy as a Web App

1. Top right of the editor: **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Fill in:
   - **Description:** anything, e.g. "Initial deployment"
   - **Execute as:** **Me** (your account)
   - **Who has access:** **Anyone**
4. Click **Deploy**, then **Authorize access** again if prompted (same flow as step 3).
5. Copy the **Web app URL** shown — it looks like
   `https://script.google.com/macros/s/AKfycb.../exec`. You'll need it next.

   > **Why "Anyone" and not "Only myself"?** Because `index.html` is a static file
   > that calls the API with a plain `fetch()` — it isn't logged into Google. Anyone
   > tighter than "Anyone" would redirect those requests to a Google sign-in page,
   > which `fetch()` can't complete. See **Security notes** below for how this is
   > compensated for.

## 5. Connect the frontend

1. Open `index.html` in a text editor and find the `CONFIG` block near the top of
   the `<script>` section:
   ```js
   const CONFIG = {
     API_URL: 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE',
     API_KEY: 'my-journal-secret-2026',
     USER_NAME: ''
   };
   ```
2. Replace `API_URL` with the URL you copied in step 4.
3. Replace `API_KEY` with the same random string you set in `Code.gs` (step 2.4).
4. Optionally set `USER_NAME` for a personalized greeting ("Good evening, Heng").
5. Save the file.

## 6. Open it

Just double-click `index.html` — it runs entirely in the browser, no server needed.
To use it from your phone too, or share it with nobody but yourself, drop it into
any static host (GitHub Pages, Netlify, Google Drive → publish, etc.) or leave it
as a local file. Either way it talks directly to your Apps Script URL.

---

## Updating the script later

Apps Script deployments are **versioned** — editing `Code.gs` after deployment does
**not** change what the live URL runs until you publish a new version:

1. **Deploy → Manage deployments**.
2. Click the **pencil icon** on your existing deployment.
3. Under **Version**, choose **New version**.
4. Click **Deploy**.

This keeps the same URL (so you don't have to touch `index.html` again) while
pushing your code changes live.

---

## How the pieces talk to each other

Every request from `index.html` — even just listing entries — is a `POST` to a
single `doPost(e)` function in `Code.gs`, with an `action` field (`list`, `create`,
`update`, `delete`) telling it what to do. This is deliberate, not an oversight:
Apps Script web apps can't respond to CORS "preflight" (`OPTIONS`) requests, so a
normal `fetch()` with a JSON content-type gets blocked by the browser before it ever
reaches your script. Sending the body as `text/plain` instead keeps the browser from
sending a preflight at all, and `doPost` just parses the text as JSON on arrival.
It's a well-known, standard workaround for this specific Apps Script limitation —
not a hack specific to this app.

---

## Security notes

Being upfront about what this setup does and doesn't protect against:

- **The deployed URL is effectively the only lock on your data.** With "Execute as:
  Me / Who has access: Anyone," anyone who has (or guesses) your exact `/exec` URL
  can call the API — read, add, edit, or delete entries — without logging in. Apps
  Script URLs are long and unguessable in practice, so treat the URL itself as a
  secret: don't commit `index.html` with a real URL in it to a public GitHub repo,
  don't post the URL anywhere public.
- **The `API_KEY` check is a trip-wire, not a lock.** It lives in `index.html`'s
  source, so anyone who views the page source or opens dev tools can read it. It
  won't stop a targeted attacker, but it does stop drive-by scanners that find your
  URL and try calling it blind without ever reading your frontend first. Real
  protection is the URL secrecy above.
- **Formula/CSV injection is handled at the sheet level.** A journal entry that
  starts with `=`, `+`, or `-` could otherwise be interpreted as a spreadsheet
  formula (or, if you ever export to CSV and open it in Excel, could trigger a
  known formula-injection risk). `Code.gs` sets the data columns to plain-text
  format when it creates the sheet, so this can't happen — text is always stored
  and read back exactly as typed.
- **All rendering in `index.html` uses `textContent`/DOM APIs, never `innerHTML`
  with entry data.** So even if you paste something like `<script>` into a journal
  entry, it's displayed as literal text, never executed.
- **The backend validates everything server-side** (required fields, length limits,
  date format) — it doesn't just trust whatever the frontend sends, so a malformed
  or hand-crafted request can't corrupt a row.
- **There's no rate limiting.** Apps Script doesn't give you the caller's IP or an
  easy hook for this. For personal use this is a low-priority gap, but worth
  knowing if you ever share the URL more widely than intended.

## Recommended improvements

Roughly in order of what's likely to matter most for personal use:

1. **Move `API_KEY` into Script Properties** instead of a hardcoded constant, so
   it's not sitting in plain text if you ever share `Code.gs` itself
   (`Project Settings → Script properties` in the Apps Script editor, then read it
   with `PropertiesService.getScriptProperties().getProperty('API_KEY')`).
2. **Back up periodically.** Google Sheets keeps version history
   (`File → Version history`), which covers accidental edits, but a periodic export
   (File → Download → .xlsx or .csv) is good insurance against anything more
   serious.
3. **Add photo attachments** — e.g. upload to a linked Google Drive folder and store
   the file URL in an added `photoUrl` column.
4. **Add a data export button** in the UI (JSON or CSV) for your own backups without
   needing to open the Sheet directly.
5. **Add pagination** if your entry count ever grows into the thousands — right now
   every `list` call fetches all rows at once, which is simple and fine for years of
   daily entries, but would eventually benefit from date-range queries.
6. **Turn it into a PWA** (a small `manifest.json` + service worker) if you want an
   installable icon and basic offline viewing on your phone.
7. **A calendar heatmap view** (like a GitHub contributions graph) would be a nice
   companion to the streak counter, showing writing consistency at a glance.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Setup needed" banner never goes away | `CONFIG.API_URL` in `index.html` still has the placeholder text — check step 5. |
| Every action fails with "Unauthorized: invalid API key" | `API_KEY` in `Code.gs` and `CONFIG.API_KEY` in `index.html` don't match exactly (whitespace counts). |
| Everything worked before, now nothing saves/loads | You edited `Code.gs` but didn't publish a **new version** of the deployment — see "Updating the script later" above. |
| Browser console shows a CORS error | Double check `index.html` is sending `Content-Type: text/plain;charset=utf-8` (it does, by default, in the code provided) — if you've modified `apiCall()`, this is the most likely culprit. |
| "Failed to fetch" / network error | Check the URL ends in `/exec` (not `/dev`), and that "Who has access" is set to **Anyone**. |
| `TypeError: Cannot read properties of null (reading 'getSheetByName')` | `SHEET_ID` at the top of `Code.gs` still has the placeholder text, or has the wrong value — double check it against the ID in your Sheet's URL (step 2). |
| New sheet doesn't appear | Confirm `SHEET_ID` points at the Sheet you're looking at — it's easy to paste the ID from the wrong tab if you have more than one Sheet open. |
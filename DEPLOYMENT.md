# MARA Survey Deployment Guide

## 1. Project Files
Use this structure:

- `index.html`
- `app.js`
- `Code.gs` (for Google Apps Script project)
- `README.md`

## 2. Google Sheet Setup
1. Create a new Google Sheet.
2. Name first sheet `Responses` (or keep default; script will create `Responses` if missing).
3. Copy the Spreadsheet ID from the URL:
   - `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`

## 3. Apps Script Setup
1. Go to [script.new](https://script.new).
2. Replace default code with contents of `Code.gs`.
3. In **Project Settings** -> **Script properties**, add:
   - `SPREADSHEET_ID` = your sheet ID
   - `ALLOWED_ORIGINS` = GitHub Pages origins, comma-separated.
     Example:
     - `https://yourusername.github.io`
     - `https://yourusername.github.io/mara-survey`
4. Save.

## 4. Deploy as Web App
1. Click **Deploy** -> **New deployment**.
2. Type: **Web app**.
3. Execute as: **Me**.
4. Who has access: **Anyone**.
5. Deploy and authorize requested permissions.
6. Copy the web app URL ending with `/exec`.

## 5. Frontend API Connection
1. Open `app.js`.
2. Set:
   - `const API_URL = 'YOUR_APPS_SCRIPT_EXEC_URL';`
3. Commit and push.

## 6. GitHub Pages Hosting
1. Push files to GitHub repository.
2. In GitHub repo settings -> **Pages**:
   - Source: `Deploy from a branch`
   - Branch: `main` (or `master`) and `/root`
3. Save and wait for published URL.

## 7. Local Testing
Because the frontend is static, test with a simple local server (not `file://`).

Examples:
- Python: `python -m http.server 5500`
- Node: `npx serve .`

Then open `http://localhost:5500`.

## 8. How Duplicate Prevention Works
- Frontend: blocks immediate repeat submissions for 30 seconds using local storage.
- Backend: blocks rapid duplicate fingerprints for 30 seconds using Apps Script cache.
- Honeypot field blocks basic bots.

## 9. Security Notes and Limitations
- GitHub Pages is public; client code and endpoint URL are visible.
- Origin checks in Apps Script rely on payload metadata and are helpful but not perfect.
- For stronger protection, use CAPTCHA (Cloudflare Turnstile/reCAPTCHA) and server-side token verification.
- Do not store very sensitive personal data without stronger auth and encryption controls.

## 10. Updating Questions Later
1. Update question markup in `index.html`.
2. Keep existing `name`/`id` patterns when possible.
3. If you add new data keys, add them to `getDynamicSurveyKeys_()` in `Code.gs` to create new columns automatically.
4. Re-deploy Apps Script after backend edits.

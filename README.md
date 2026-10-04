# SwivProtect (by Swivel): scam protection before, during, after

## Run it
    npm run setup     # once: builds data/catalog.db from data/catalog.json (needs python3)
    npm start         # http://localhost:3000
    npm run demo      # in a second terminal: fires a sample community alert (see below)
    npm run reset     # wipes data/live.db (users, reports, alerts) for a clean start

Optional: `ANTHROPIC_API_KEY=sk-... npm start` adds a plain-language Claude explanation to scam checks.

## Databases (data/)
- `catalog.db`  STATIC. 20 base scams, red-flag words in 5 languages, alert templates, FTC stats. Built from `catalog.json`.
  To ship a patch: edit `catalog.json` (add a scam, bump `version`, add a `patches` entry), run `npm run setup`.
- `live.db`     REVOLVING. users, reports, alerts, notifications. Reports/alerts older than 30 days are purged automatically.
- Rules (5 reporters in 30 days -> alert; max 15 reports per scam per 2 shared categories) live in `data/live_db.py`
  (reference + tests: `python3 data/test_live.py`) and are mirrored in `server.js`.

## Screens (match the Figma wireframe, 2 bottom tabs)
- Login, 2-step sign-up (account details, then About you: state, age range, language).
- **Home & profile**: first-name greeting, community alerts, Check a message, Your reports (with outcome chips), Edit profile (incl. device key).
- **Report a scam**: scam type, where it happened, did you lose money.
- Brand: logo purple `#500778`, magenta `#bb16a3`, background `rgb(238,233,241)`.

## Tiers
- **Before**: community alerts. When 5 people report the same scam within 30 days and share a state, age range or language,
  everyone else with that state / age range / language gets the red-flag words in their language (Alerts tab).
- **During**: `/api/analyze` scans a message against the catalog's red flags. Used by the Check tab, the Gmail add-on and the SMS automation.
- **After**: Report tab. Victims get recovery steps; everyone's report feeds the alerts above.

## Gmail add-on
1. `ngrok http 3000`, put the URL in `gmail-addon/Code.gs` (`API`) and `appsscript.json` `urlFetchWhitelist`.
2. Me tab -> copy your key -> paste into `TOKEN` in `Code.gs`.
3. script.google.com -> new project -> paste both files (show manifest in settings) -> Deploy -> Test deployment -> Gmail add-on.

## Android SMS automation (MacroDroid / Tasker)
- Trigger: SMS received, sender NOT in contacts.
- Action: HTTP POST `https://<your-tunnel>/api/analyze`, header `Authorization: Bearer <key>`,
  JSON body `{"body":"[sms_message]"}` (no phone numbers are sent or stored).
- If response `level` is `high` or `medium`: show a notification with `headline`. Nothing is texted to anyone.
- Permissions needed: receive SMS and read contacts (to skip saved numbers). No send-SMS permission.

## Running on an Android phone
It is a web app that installs like an app (manifest + service worker).
- **Layout/Back button check (same Wi-Fi):** `http://<your-computer-LAN-IP>:3000` in Chrome on the phone. Notifications and install need HTTPS, so:
- **Full test (HTTPS tunnel):** `brew install cloudflared`, then `cloudflared tunnel --url http://localhost:3000` and open the https URL it prints.
  Chrome menu -> Install app (or Add to Home screen). Allow notifications from the Me tab.
- **USB alternative:** `brew install android-platform-tools`, `adb reverse tcp:3000 tcp:3000`, open `http://localhost:3000` on the phone.
- Alerts arrive while the app is open (polled every 10 seconds). Alerts to a closed app need web push (not built yet).

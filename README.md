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

## Android text-message app (android/)
A small Kotlin app that checks texts from numbers that are NOT in your contacts and shows a warning notification.
- Only the message text of unknown senders goes to `/api/analyze` (no phone numbers, nothing stored). Saved contacts are checked on the phone and never sent.
- Permissions: receive SMS and read contacts (to skip saved numbers), plus notifications. No send-SMS permission.
- Build and install on the emulator (needs Android Studio's Java; first build downloads Gradle):

      cd android
      export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
      ./gradlew assembleDebug
      ~/Library/Android/sdk/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk

- Open "SwivProtect Texts" on the phone, paste your key (SwivProtect app: Me, then Edit profile), tap "Allow what is needed", then "Test the connection".
- Server address: `http://localhost:3000` works on the emulator after `adb reverse tcp:3000 tcp:3000`. On a real phone use an https address (plain http is only allowed to localhost and 10.0.2.2).
- Tapping a warning opens a popup about that specific scam (what it is, what to do, the warning words found) with a **Report this scam** button that asks only "Did you lose money?" and files the report as an SMS report. The tips live in `data/catalog.json` (`tips` per scam).
- Try it: `adb emu sms send 5551234 "Your package could not be delivered. Pay the redelivery fee at usps-redeliver.top"`.
  Save 5551234 as a contact and send again to see it ignored.

## Running on an Android phone
It is a web app that installs like an app (manifest + service worker).
- **Layout/Back button check (same Wi-Fi):** `http://<your-computer-LAN-IP>:3000` in Chrome on the phone. Notifications and install need HTTPS, so:
- **Full test (HTTPS tunnel):** `brew install cloudflared`, then `cloudflared tunnel --url http://localhost:3000` and open the https URL it prints.
  Chrome menu -> Install app (or Add to Home screen). Allow notifications from the Me tab.
- **USB alternative:** `brew install android-platform-tools`, `adb reverse tcp:3000 tcp:3000`, open `http://localhost:3000` on the phone.
- Alerts arrive while the app is open (polled every 10 seconds). Alerts to a closed app need web push (not built yet).

## Brand logo
`public/swivel-logo.svg` is Swivel's registered logo and is deliberately not in the repo. Copy it into `public/` to see it; without it the app shows a plain "SwivProtect" title.

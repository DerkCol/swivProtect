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

## Android app (android/): the full SwivProtect app
The Android app shows the same screens as the web app (login, home, alerts, reports, check a message, profile) inside a WebView, so there is one UI to maintain, and adds the phone-only parts through a small bridge:
- It remembers your login by itself, so the text-message checker needs no copy and paste.
- After sign-up it asks for the phone permissions (receive SMS, read contacts to skip saved numbers, notifications). No send-SMS permission.
- Texts from numbers that are NOT in your contacts are checked on the server (only the message text is sent, never the number). A warning notification opens a popup about that scam, with a Report button.
- Community alerts from the web app arrive as real phone notifications while the app is open.
- The Android Back button steps back through the app's own screens.

Build and install on the emulator (needs Android Studio's Java; the first build downloads Gradle):

    cd android
    export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
    ./gradlew assembleDebug
    ~/Library/Android/sdk/platform-tools/adb reverse tcp:3000 tcp:3000
    ~/Library/Android/sdk/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk

- The server must be running (`npm start`). The app loads `http://localhost:3000` (works on the emulator after `adb reverse`). If the server cannot be reached the app shows a screen to type another address; plain http is only allowed to localhost and 10.0.2.2, anything else must be https.
- Try it: `adb emu sms send 5551234 "Your package could not be delivered. Pay the redelivery fee at usps-redeliver.top"`. Save 5551234 as a contact and send again to see it ignored.
- On a real phone, an app installed from a file may need Settings, Apps, SwivProtect, menu, "Allow restricted settings" before the SMS permission can be granted.

## Running on an Android phone
It is a web app that installs like an app (manifest + service worker).
- **Layout/Back button check (same Wi-Fi):** `http://<your-computer-LAN-IP>:3000` in Chrome on the phone. Notifications and install need HTTPS, so:
- **Full test (HTTPS tunnel):** `brew install cloudflared`, then `cloudflared tunnel --url http://localhost:3000` and open the https URL it prints.
  Chrome menu -> Install app (or Add to Home screen). Allow notifications from the Me tab.
- **USB alternative:** `brew install android-platform-tools`, `adb reverse tcp:3000 tcp:3000`, open `http://localhost:3000` on the phone.
- Alerts arrive while the app is open (polled every 10 seconds). Alerts to a closed app need web push (not built yet).

## Brand logo
`public/swivel-logo.svg` is Swivel's registered logo and is deliberately not in the repo. Copy it into `public/` to see it; without it the app shows a plain "SwivProtect" title.

# SwivProtect (by Swivel): scam protection before, during, after

## Run it
    npm run setup     # once: builds data/catalog.db from data/catalog.json (needs python3)
    npm start         # http://localhost:3000
    npm run demo      # in a second terminal: fires a sample community alert (see below)
    npm run reset     # wipes data/live.db (users, reports, alerts) for a clean start

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
- **During**: `/api/analyze` scans a message against the catalog's red flags. Used by the Check tab, the Gmail add-on and the Android text checker.
- **After**: Report tab. Victims get recovery steps; everyone's report feeds the alerts above.

## Putting it on a server
See [docs/DEPLOY.md](docs/DEPLOY.md): a step-by-step guide for a Linux server (Node, a systemd service, Caddy for HTTPS, backups, updating, troubleshooting), with ready-made files in `deploy/`. On AWS (EC2, from the console, using the zip built by `deploy/make-zip.sh`): [docs/DEPLOY-AWS.md](docs/DEPLOY-AWS.md).
`/healthz` answers `ok` when the server and database are fine (for uptime checks).

## Abuse protection (server.js)
Added after testing showed 100 simultaneous sign-ups, unlimited password guesses, a 1 MB name and a 40 MB upload were all accepted. Now:
- **Size:** a request body over 100 KB is refused (413) without being read (`MAX_BODY_BYTES`). Name 80, email 254, password 128 characters. Only the first 20,000 characters of a message are scanned.
- **Rate limits** (in memory, per address or per signed-in person, answered with 429 and a Retry-After): sign-ups 60 an hour per address and 600 an hour overall (this also caps how fast the user table can grow), logins 100 per 10 minutes per address,
  scam checks 60 a minute per person, reports 30 an hour, link codes 10 an hour, everything else 120 a minute per person and 1200 a minute per address (the app itself uses about 15 a minute).
- **Lockout:** 10 wrong passwords on one account refuses logins to it for 15 minutes (right password included).
- **Closed doors:** no cross-site (CORS) access, so a web page cannot use visitors' browsers to flood the API; `X-Frame-Options`, `nosniff`, `no-referrer`, `no-store` headers; the Google key address must be https; request timeouts of 30 seconds.
- **Polite refreshing:** the app stops its 10-second refresh while hidden, never runs two refreshes at once, and waits when told to slow down.
- Settings: `RATE_LIMITS='{"signupIp":5}'` changes a limit, `RATE_LIMITS=off` disables them (development only). Behind a proxy or tunnel that sets X-Forwarded-For, start with `TRUST_PROXY=1`, otherwise everyone behind it shares one allowance.
  Counters live in memory, so restarting the server resets them.
- Debugging: WebView debugging is on only for debug builds of the Android app (never ship the debug APK); the add-on's `SWIVEL_DEBUG` card only shows your own sign-in details and only when you set it; error answers never include server details.

## Gmail add-on (gmail-addon/)
Checks the email you open and shows a warning card (scam, warning words, what to do). Only the subject and text of the opened email are sent; the server does not store them.
It can identify the user in two ways:
- **Google sign-in (default, nothing to copy).** The add-on sends Google's sign-in token. The server accepts it only if it is signed by Google, unexpired, has a verified email, and was issued to the client ID in `GOOGLE_AUDIENCE`.
  The first time, the add-on asks for a one-time code: in the app open Edit profile, Gmail add-on, Get a link code (works once, expires in 10 minutes). That links the Gmail address to the account; after that it is automatic.
  A Google token can only reach the email check, never the account or its private key. Linking needs the code on purpose, so nobody can claim someone else's Gmail address.
- **A key (simple, for one tester).** Set the script property `SWIVEL_TOKEN` to the key shown in Edit profile, Private key.

Server: Gmail sign-in is off unless you start it with the client ID, `GOOGLE_AUDIENCE=<client id> npm start` (several IDs may be separated by commas).
To find the client ID, set the script property `SWIVEL_DEBUG=1` and open the add-on home card (it shows the audience), or try once and read the server log: a rejected token prints the audience it saw.
Other settings: `LINK_CODE_TTL_SECONDS` (default 600), `GOOGLE_JWKS_URL` and `SWIVEL_DATA_DIR` (used by tests).

Google side: script.google.com, new project, paste `Code.gs` and `appsscript.json` (Project Settings, show the manifest file), add script properties `SWIVEL_API` (the server's public https address, no trailing slash)
and optionally `SWIVEL_TOKEN` or `SWIVEL_DEBUG`, then Deploy, Test deployments, install. Google needs a public https address, not localhost, for example a tunnel.
Permissions asked: read the email being opened (`gmail.addons.current.message.readonly`), your Google email address (`openid`, `userinfo.email`), and contact the server.

Tests: `npm test` (token checking, linking, and every add-on path using stand-ins for Google's services; this cannot prove Google's real services behave the same).

## Android app (android/): the full SwivProtect app
The Android app shows the same screens as the web app (login, home, alerts, reports, check a message, profile) inside a WebView, so there is one UI to maintain, and adds the phone-only parts through a small bridge:
- It remembers your login by itself, so the text-message checker needs no copy and paste.
- After sign-up it asks for the phone permissions (receive SMS, read contacts to skip saved numbers, notifications). No send-SMS permission.
- Texts from numbers that are NOT in your contacts are checked on the server (only the message text is sent, never the number). A warning notification opens a popup about that scam, with a Report button.
- Community alerts arrive as real phone notifications. While the app is open it checks every 10 seconds; when it is closed, Android runs a background check about every 15 minutes (the shortest repeat Android allows, so an alert can be up to about 15 minutes late). The phone remembers which alerts it already announced, so nothing arrives twice. Alerts you missed show a "New" tag when you open the app. Instant delivery to a closed app would need Google's push service (Firebase), which is not set up.
- Texts are different: a scam text is checked the moment it arrives, even if the app is closed (not force-stopped), because Android starts the app for it.
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

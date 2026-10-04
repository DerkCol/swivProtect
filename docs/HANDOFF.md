# SwivProtect handoff (read this first)

Written 2026-10-03 for another Claude agent (or person) continuing this project, for example on a Mac with Xcode.
It summarizes a long working session: what exists, why it is the way it is, what is decided, what is pending, and the traps found.
Nothing here is a secret. Do not paste access tokens or passwords into chat or files.

## 1. What this is

**SwivProtect** is a hackathon project by/for **Swivel** (the logo reads "An SWBC Company"): scam protection for older adults, in three tiers.

1. **Before an attack:** people sign up with state, age range and preferred language. When 5 different people report the same scam within 30 days and share a state, age range or language, everyone else with that value gets an alert listing 3-5 warning words, in their language.
2. **During an attack:** a message is checked against the red-flag words of a static catalog of 20 scams. On Android, texts from numbers NOT in contacts are checked automatically and a warning notification opens a popup about that scam with a Report button. A Gmail add-on is written (Google sign-in with a one-time link code, or a key) and covered by automated tests that use stand-ins for Google, but it has never been deployed to Google.
3. **After an attack:** a 4-step report flow (category, scam, SMS or Email, did you lose money). Victims get recovery steps. Reports feed the alerts above.

The owner is presenting science-fair style. The demo is **recorded inside Android Studio's emulator** and put in a slideshow. It does not need other devices.

## 2. The person and how to work with them

- They are building this for a hackathon and want working things fast. They asked to be "grilled" with clarifying questions, so prefer asking 2-4 decisive questions to guessing, then act.
- Use they/them for them. They answered tersely ("no", "yes", numbers). Take short answers literally.
- Keep explanations plain and non-technical. They asked what-it-means questions about databases, git and Android.
- Never ask them to paste tokens or passwords. The GitHub push is blocked on THEIR sign-in (see section 8).
- Show before you delete. They explicitly authorized deleting things nobody discussed, but git is the safety net, so commit when they ask.

## 3. Repository layout (`~/swivel`, git repo, branch `main`)

```
server.js                 Node HTTP server, no dependencies. Serves public/ and the /api routes. Uses built-in node:sqlite.
recovery.js               Recovery steps shown to someone who clicked or paid.
demo-seed.js              Demo helper: registers 5 users and has them report one scam, to fire an alert (`npm run demo`).
package.json              Scripts: setup, start, demo, reset.
data/
  catalog.json            THE source of truth for the static catalog: version, patches, 5 categories, 20 scams,
                          red-flag words in 5 languages, 3 tips per scam, alert templates, FTC stats.
  build_catalog.py        Validates catalog.json and builds catalog.db (`npm run setup`).
  catalog.db              Built output (committed). Static, read-only to the app.
  live_schema.sql         Schema for live.db (users, reports, alerts, notifications).
  live.db                 Runtime data (NOT in git). Created automatically. `npm run reset` deletes it.
  live_db.py, test_live.py  Python REFERENCE copy of the alert rules with tests. Not used at runtime; server.js mirrors it.
public/
  index.html              The whole web app (single file: HTML, CSS, JS). Mobile-first, brand colors.
  manifest.webmanifest, sw.js, icon-*.png   PWA install support (generated shield icon).
  swivel-logo.svg         Swivel's registered logo. DELIBERATELY NOT IN GIT. App falls back to a text title if missing.
android/                  Kotlin Android app (see section 6). Gradle wrapper included.
gmail-addon/              Apps Script (Code.gs, appsscript.json). Tested with stand-ins for Google (`npm test`); never deployed to Google.
googleAuth.js             Verifies Google sign-in (ID) tokens with no library. Used only for the Gmail add-on.
test/                     Automated tests (`npm test`): token verifier, Gmail linking on the real server, every add-on code path.
docs/                     ERD-detailed.md (Mermaid ERD with column descriptions), this file.
README.md                 Run instructions.
```

## 4. How to run it

```
npm run setup      # once: python3 data/build_catalog.py builds data/catalog.db
npm start          # http://localhost:3000
npm run demo       # second terminal: FL, 26-40, English, scam #1 -> fires an alert for anyone sharing state/age/language
npm run reset      # wipes data/live.db (stop the server first or restart it after)
npm test           # 31 tests: Gmail sign-in verifier, linking flow on a real server with a temp database, and gmail-addon/Code.gs paths
```
Node 24 (built-in `node:sqlite` prints an "experimental" warning, harmless). Python 3 is only needed for `npm run setup`.

## 5. Data and API

Two SQLite files, both attached on one connection in server.js. See `docs/ERD-detailed.md`.

- `live.db`: `users` (name stored as "Last, First", email, scrypt password hash, `token`, state, age_group, language), `reports`
  (user_id, scam_id, source Email/SMS, outcome blocked/fell_for/unsure, copied state/age/language, started_alert), `alerts`, `notifications`.
- `catalog.db`: `categories`, `scams`, `red_flags` (per language), `tips`, `notification_templates`, `patches`, `meta`, `stats`.
- Allowed values: states = 50 + DC; age groups `18-25, 26-40, 41-60, 60+`; languages `English, Spanish, Chinese, Tagalog, Vietnamese`
  (Italian was dropped when the user said "top 5 languages in the US"; confirm if it matters).

Auth: `Authorization: Bearer <token>`. Routes: `/api/options`, `/api/catalog`, `/api/signup`, `/api/login`, `/api/me` (GET/PUT),
`/api/reports` (POST), `/api/my-reports`, `/api/notifications`, `/api/stats`, `/api/analyze` (POST, the "during attack" check),
`/api/link-code` (POST, signed-in user gets a one-time code), `/api/link-gmail` (POST, Google token + code), `/api/unlink-gmail` (POST).

Abuse protection (added after a flood test; see README "Abuse protection"): body cap 100 KB (413), field lengths, per-address and per-person rate limits (429 + Retry-After) held in memory in `server.js` (`LIMITS`, `take()`),
per-account lockout after 10 wrong passwords, no CORS, security headers, `TRUST_PROXY` / `RATE_LIMITS` / `MAX_BODY_BYTES` settings, JWKS address must be https. Tests: `test/hardening.test.mjs`. The web app pauses its refresh when hidden and honours Retry-After.
If something shows "Too many requests" during development, restart the server (counters reset) or start it with `RATE_LIMITS=off`.

Gmail add-on sign-in (added later; read this before touching auth):
- `users.google_email` (unique, nullable) holds the linked Gmail address; `live.db` files made before it existed are upgraded automatically on start.
- Off unless `GOOGLE_AUDIENCE` is set (the OAuth client ID(s) the add-on's token is issued to). A JWT-shaped bearer then goes to `googleAuth.js`: RS256 only, signature checked against Google's published keys (cached,
  refetched at most once a minute for an unknown key id), issuer Google, not expired, audience configured, email verified. Everything else is rejected.
- A Google token is accepted ONLY by `/api/analyze` (as the linked user) and `/api/link-gmail`. It is refused everywhere else, so it can never fetch the long-lived `token` from `/api/me`.
- Linking: the signed-in app asks `/api/link-code` for an 8-character code (in memory, single use, expires after `LINK_CODE_TTL_SECONDS`, default 600); the add-on sends it with the Google token to `/api/link-gmail`.
  Five wrong tries per Gmail address per 10 minutes, then 429. A Gmail address already linked to a different account gets 409. The code step exists because SwivProtect does not verify sign-up emails, so matching by email alone would let someone register another person's address first.
- Not verified against real Google: the audience value of a real Apps Script token. Use the add-on's `SWIVEL_DEBUG=1` home card or the server log to read it, then set `GOOGLE_AUDIENCE`.
- The add-on requests only: `openid`, `userinfo.email`, `gmail.addons.execute`, `gmail.addons.current.message.readonly` (just the open email), `script.external_request`.

Rules in code (server.js, mirrored in live_db.py):
- Alert fires when `ALERT_THRESHOLD = 5` distinct reporters of one scam share state OR age_group OR language within 30 days. One alert per scam+dimension+value per window; reporters excluded; one notification per user per scam.
- Cap: store at most `PAIR_CAP = 15` reports of a scam that share any two of state/age/language. Same person re-reporting a scam is ignored.
- Reports, alerts, notifications older than 30 days are deleted (on each report and hourly).
- `/api/analyze`: counts each DISTINCT matched flag word once (a word like "USPS" exists in several languages' lists and must not be counted per language). 3+ distinct words = high, 2 = medium, else low. Payment-method words and links add weight only when 2+ words already matched.
  Returns a localized headline (English/Spanish/Chinese/Tagalog/Vietnamese built in), the scam, matched words, tips, community count.
  Optional Claude explanation only if `ANTHROPIC_API_KEY` is set (not used so far).
- Message text is never stored or logged. Sender phone numbers are never sent to the server.

## 6. Android app (`android/`)

Kotlin, no third-party libraries. `compileSdk 37`, `minSdk 26`, `targetSdk 36`, AGP 9.4.1, Gradle wrapper 9.6.0 (AGP 9.4.1 requires Gradle 9.6.0).
Build needs Android Studio's bundled JDK 25 and the Android SDK (platform 37, build-tools 36):
```
cd android
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
./gradlew assembleDebug
adb reverse tcp:3000 tcp:3000
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
(`~/Library/Android/sdk/platform-tools/adb` is not on PATH.) Package `com.swivel.swivprotect.sms`, label "SwivProtect".

It is **the full app**: `MainActivity` hosts the web app in a WebView at `http://localhost:3000` (works on the emulator after `adb reverse`;
plain http is allowed only for localhost/127.0.0.1/10.0.2.2 via `network_security.xml`). A JS bridge `window.SwivNative` provides:
`saveSession(token)`, `clearSession()`, `permissionStatus()`, `requestPermissions()`, `notify(id,title,body)`. The web app detects it with `window.SwivNative`
and then: saves the login natively (no key copy/paste), asks for permissions once after login, shows a "Text-message protection" card on Home,
posts community alerts as real notifications, and exposes `window.nativeBack()` for the Android Back button (Chrome ignores history entries made without a
real tap, so the app asks the page to step back instead of using WebView.canGoBack).

Text checking: `SmsReceiver` (RECEIVE_SMS) -> skip if sender is a saved contact or contacts permission is missing -> POST `{body}` to `/api/analyze` ->
if medium/high show a notification (`Notifier`) that opens `ScamAlertActivity`, a dialog popup with the scam summary, 3 tips, matched words, and
**Report this scam** (asks only "Did you lose money?", files an SMS report; shows recovery steps if they lost money). Permissions: RECEIVE_SMS, READ_CONTACTS,
POST_NOTIFICATIONS, INTERNET. No SEND_SMS (the user decided: no outgoing texts, ever).

Testing on the emulator (Pixel 8a, API 37, arm64): `adb emu sms send 5551234 "Your package could not be delivered. Pay the redelivery fee at usps-redeliver.top"`.
Debug builds enable WebView debugging: forward `localabstract:webview_devtools_remote_<pid>` and use Chrome DevTools Protocol to drive/inspect the page.

Gotchas found:
- A **force-stopped** app receives no SMS broadcasts until opened once. Not a bug for real users.
- `adb shell pm grant` skips the real SMS permission prompt; revoke first to see real prompts (all three appear for a normal install).
- On Android 13+, a sideloaded app may need Settings > Apps > SwivProtect > menu > "Allow restricted settings" before the SMS permission can be granted.
- The first-run Chrome sign-in screens in the emulator need dismissing.
- Community-alert notifications: instant while the app is open (it polls every 10 s); when closed, `AlertCheckJob` (a JobScheduler job, id 4711, about every 15 minutes, persisted across restarts) fetches `/api/notifications` and announces new ones. `Alerts.kt` keeps one "announced up to alert N" pointer shared by the job and the web page (via the `notifyAlert` / `markSeen` bridge calls) so nothing is announced twice. Instant delivery to a closed app would need Firebase push (not built). To test the job without waiting: `adb shell cmd jobscheduler run -f com.swivel.swivprotect.sms 4711`.
- Scam TEXTS are checked on arrival even when the app is closed (a manifest receiver; Android starts the process), except after Force stop.
- Needs `RECEIVE_BOOT_COMPLETED` and `ACCESS_NETWORK_STATE` (the job has a network constraint; without the second one scheduling throws and used to block sign-in until it was caught).

## 7. Web app facts

- Two bottom tabs only (Home & profile, Report a scam), matching the owner's Figma wireframe. Alerts, Check a message and Edit profile live on Home / sub-screens.
- Home greets the **first name only** (an explicit requirement).
- Brand: purple `#500778`, magenta `#bb16a3`, background `#EEE9F1` (rgb 238,233,241). Large type and 48px touch targets for older users. No dark mode (removed on purpose).
- Sign-up is 2 steps (details, then "About you": state, age range, language). Password: 8+ characters with a letter and a number.
- Report flow is 4 tap steps (5 categories x 4 scams, then SMS/Email, then outcome); at most 5 big buttons per screen.
- Removed on purpose (not discussed): phone number on profile, screenshot upload, free-text description, "Forgot password", fake "In review" status, dark mode.
- Terms of use / Privacy policy are plain text in the checkbox (no pages exist).
- The Figma file (SwivProtect) is private; the Figma connector was never connected. Design came from screenshots of the wireframe.

## 8. State at the time of writing

**Committed locally** (2 commits): initial prototype; then Android text checker, popup, tips, scoring fix.

**NOT committed yet** (the owner said "commit later", keep reminding them):
- the Android rewrite into the full WebView app (`android/.../MainActivity.kt`, `Notifier.kt`, `AndroidManifest.xml`);
- web hooks in `public/index.html` (native bridge, `window.nativeBack`, wording fix);
- `README.md` updates;
- `docs/` (ERDs and this file).

**GitHub:** remote `https://github.com/DerkCol/SwivProtect.git` is set but `git push` fails with "could not read Username": this Mac is not signed in to GitHub
and the `gh` CLI is not installed. The owner chose to skip GitHub for now. To push: they sign in (brew install gh; gh auth login, or GitHub Desktop, or a personal access token entered by them), then `git push -u origin main`. The owner's GitHub username appears as `DerkCol` in URLs and `DerekCol` in git config; the URL is what counts.
`public/swivel-logo.svg` must stay out of git (private asset), as must `data/live.db`.

**live.db currently holds test users** (names like Rosa Garcia, "Reporter1 Demo"). Run `npm run reset` (and restart the server) before the real recording.

## 9. What the owner wants next (in order)

1. **Gmail add-on** (in progress). Code and server side are done and tested (see section 5). Remaining, all in the owner's hands because Google requires their sign-in and consent:
   a public https address for the server (this campus Wi-Fi blocks Cloudflare's tunnel port 7844, SSH port 22 and the other usual tunnels; `ssh -T -p 443 -R0:localhost:3000 a.pinggy.io` worked, free tunnels last about 60 minutes and the
   address changes, and Pinggy's browser warning page is skipped with the `X-Pinggy-No-Screen: 1` header the add-on already sends), then create the Apps Script project, set the script properties, install the test deployment,
   read the audience from the `SWIVEL_DEBUG=1` home card, and restart the server with `GOOGLE_AUDIENCE`. Not possible for anyone to do silently for end users: Google requires each account owner (or their Workspace admin) to approve access.
   Routes to real users: test install (no review), private install by a Workspace admin (no Google review), public Marketplace (Google review; `gmail.addons.current.message.readonly` is a "sensitive" scope).
   Add-ons only run when an email is opened; they cannot warn on arrival. The owner does NOT need the add-on to work on other devices for the demo.
2. **iOS expansion** (exploring, nothing built). See section 10.
3. Commit the pending work and eventually push to GitHub.
4. Optional ideas raised but not decided: translating the app's own UI text and the tips into the other four languages (owner said no to translating scam names; tips stay English),
   web push for alerts when the app is closed, a `npm run backup`, a test that runs the alert-rule scenarios against the real server.

## 10. iOS plan (for an agent on a Mac with Xcode)

Goal: bring SwivProtect to iPhone as far as Apple allows. Be honest in the pitch about the limits.

What carries over easily:
- The **web app** runs in Safari and can be added to the Home Screen (add `apple-touch-icon`, `apple-mobile-web-app-*` meta, check safe-area insets). iOS 16.4+ supports web push only for Home Screen web apps.
- An **iPhone app wrapper**: a `WKWebView` loading the same server, mirroring `MainActivity`. A `WKScriptMessageHandler` can mirror the `SwivNative` bridge
  (saveSession / clearSession / notify / permissions). On the iOS Simulator, `localhost:3000` reaches the Mac's server directly (no `adb reverse` equivalent needed).
  Use `mcp__Claude_Code_iOS_Simulator__control` (attach first) to run and screenshot the app if that tool is available.
- The **Gmail add-on** also works in the Gmail iOS app.

What does NOT carry over: apps cannot read incoming SMS on iOS, so there is no equivalent of `SmsReceiver`. The Apple-sanctioned route is an
**SMS Message Filter extension** (Identity Lookup, `ILMessageFilterExtension`). Notes from the design discussion (from memory, VERIFY against Apple's docs):
- The user enables it in Settings > Messages > Unknown & Spam > SMS Filtering. iOS passes the sender and body of SMS/MMS from **unknown senders** to the extension.
  It answers allow / junk / promotion / transaction. A junked message lands in the Junk list silently.
- The extension has no network of its own. It can classify locally, or call `deferQueryRequestToNetwork` so the system sends the query to a server URL declared in its
  Info.plist through Apple's relay (anonymized, so the server cannot know which user it is; it cannot push a warning to that person).
- Recommended design: classify **on the phone** using the red-flag words from the catalog. The main app copies the catalog's words into an **App Group** shared container
  for the extension to read. The extension writes a small note (scam type, matched words, time; avoid storing the full text) for each junked message into the
  same container; the main app shows "We moved N suspicious texts to Junk" with scam info and a Report button the next time it opens.
- UNVERIFIED: whether the extension can post a local notification (believed not reliable). Test on a real iPhone. A best-effort fallback is a background-refresh wake of the main app.
- Cannot show popups, cannot auto-file a report tied to the user, does not see iMessage (believed). Needs a **real iPhone** with a SIM to test (believed the simulator cannot deliver SMS to the filter), Developer Mode, and signing.
  A free Apple ID gives short-lived installs on the owner's own device (uncertain for extensions); TestFlight/App Store needs the paid Apple Developer Program (~$99/year).
- Ask the owner first: do they have an iPhone to test with? If not, put the filter on a roadmap slide and demo only the web wrapper in the simulator.

This Mac (when the session was written) had only Command Line Tools, no Xcode. The owner asked whether installing Xcode makes iOS possible: it makes the app wrapper and simulator work possible and the filter compilable, but the filter still needs a real device.

## 11. Environment notes (the machine the session ran on)

macOS (Darwin 25.3), Apple Silicon (arm64), the owner's user account, zsh. Node v24.14.1, Python 3, git 2.50.1, Android Studio 2026.2,
Android SDK at `~/Library/Android/sdk` (emulator with Pixel 8a and "Medium Phone", both API 37 / Android 17 arm64, Google Play images; adb works). No `gh`, no `ngrok`, no `cloudflared` yet.
On a new Mac: install Node 24+, Python 3, and for Android work Android Studio; paths above will differ.

## 12. Source of truth for decisions (short log)

- 20 scams in 5 categories of 4 (grouping in `catalog.json`); owner liked the category -> subcategory report flow.
- Red flags are preset words in the static catalog, per language; alerts show 3-5 of them: "Hey, others like you have been receiving prominent scam attempts. Some words to look out for: ...".
- Static catalog is updated "patch notes style" by a programmer (edit `catalog.json`, bump version, add a `patches` entry, `npm run setup`).
- Reports never expose who sent them; the alert text contains only red-flag words.
- No outgoing SMS and no stored phone numbers (owner decision).
- Warnings show the headline translated but scam names/tips in English (owner said no to translating names).
- Medium and high risk texts show the same popup with the Report button (owner decision).
- Report stays one-per-person-per-scam; ethnicity was dropped from the data model.
- Gmail add-on identifies people by Google sign-in plus a one-time link code (no key to paste); a key mode remains for a single tester. The owner approved "match by Gmail address"; the code step was added to close the unverified-email hole.

## 13. A raw transcript also exists

The full conversation was exported by the owner's request to `~/Downloads/session-export-*.zip` (about 38 MB, mostly screenshots). This document is the readable summary; use the transcript only to recover exact wording.
It is outside the repository on purpose and should not be committed.

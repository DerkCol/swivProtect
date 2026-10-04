# SwivProtect: demo runbook and presenter cheat sheet

Two recordings: a ~5 minute app demo and a ~2 minute Gmail add-on demo. Times are targets, not rules.

## Before you record (do this once, about 10 minutes)

1. **Free up memory.** This Mac has 8 GB and the virtual phone needs about 4 GB. Today the emulator died twice at startup because memory was full.
   Quit Chrome, Discord and anything else heavy. Start the phone from Terminal (lighter than from Android Studio) and give it a minute to boot:
   `~/Library/Android/sdk/emulator/emulator -avd Pixel_8a`
2. **Fresh data.** Stop the server if it is running, then:
   `cd ~/swivel && npm run reset && npm start`
   (`reset` also deletes the test accounts, including yours, so you sign up on camera, which is a good thing to show.)
3. **Connect and install the app fresh** (a fresh install shows the real permission prompts):
   ```
   ~/Library/Android/sdk/platform-tools/adb reverse tcp:3000 tcp:3000
   ~/Library/Android/sdk/platform-tools/adb uninstall com.swivel.swivprotect.sms
   ~/Library/Android/sdk/platform-tools/adb install ~/swivel/android/app/build/outputs/apk/debug/app-debug.apk
   ```
4. **Show finger taps in the recording:** `adb shell settings put system show_touches 1` (turn off afterwards with `0`).
5. **A saved contact must exist** so you can show "saved numbers are never checked". The phone already has "5551234". Check in the phone's Contacts app.
6. **Do not fire many notifications in a row.** Android mutes alerts for about 2 minutes ("notification cooldown") if too many arrive together. Clear the notification shade between beats.
7. **Never "Force stop" the app** in Settings: texts stop being checked until it is opened again.
8. **Restart the server right before recording** (step 2 does that). It also clears the abuse-protection counters: sign-ups are limited to 60 an hour per address, and each demo run uses about 6. If you ever see "Too many requests", restart the server.
9. Do one full dry run before recording.

## App demo, about 5 minutes

| Time | On screen | What to say | Command or action |
|---|---|---|---|
| 0:00 | Login screen | Scams hit older adults in waves. SwivProtect protects before, during and after an attack, in their own language. | Open the app |
| 0:25 | Create account, then "About you" | A few details, once. State, age range, language, so we can warn people like them. We never show the name. | Fill the form: Florida, 60+, Spanish |
| 1:10 | Phone permission prompts, then Home | It asks for three things: read texts, check contacts (to skip people you know), show warnings. Home greets by first name. The Text-message protection card is now On. | Tap Allow three times |
| 1:35 | **BEFORE:** alert on Home plus a phone notification | When 5 people nearby report the same scam, everyone else like them is warned, in their language, with the words to look for. | Terminal: `cd ~/swivel && node demo-seed.js FL 26-40 English 1` then wait up to 10 seconds |
| 2:15 | **DURING:** warning notification, then the popup | A scam text arrives from a number that is not in the contacts. The app checks it and warns. The popup says what this scam is, what to do and which words gave it away. | Terminal: `adb emu sms send 5559001 "Su paquete no se pudo entregar. Pague el cargo de reenvío de USPS en http://usps-redeliver.top"` then tap the notification |
| 2:55 | Popup, Report this scam | One question: did you lose money? It already knows the scam type and that it came by text. | Tap Report this scam, then "No, I stopped it" |
| 3:15 | Nothing happens | The same text from a saved contact is ignored, and never leaves the phone. | `adb emu sms send 5551234 "Su paquete no se pudo entregar. Pague el cargo de reenvío de USPS en http://usps-redeliver.top"` |
| 3:30 | **Check a message** | Paste anything suspicious and see it checked against known scams. | Home, Check a message, paste: `IRS notice: arrest warrant issued. Pay back taxes today with gift cards https://irs-pay.top` |
| 4:00 | **AFTER:** Report a scam, 4 taps | Never more than five big buttons at a time. If someone lost money, they get clear steps right away. | Report a scam, Government, Government impersonation, Text message, "Yes, I lost money" |
| 4:40 | Home, Your reports | Reports feed the alerts for the next person. Names are never shared. | Back to home, scroll to Your reports |
| 4:50 | Closing line | Roadmap: Gmail add-on today, instant push alerts next. | Optional: say the closed-app point below |

Optional line about the app being closed: a scam text is checked the moment it arrives even if the app is closed. Community alerts reach a closed app within about 15 minutes.

To make the closed-app point on camera, run `adb shell cmd jobscheduler run -f com.swivel.swivprotect.sms 4711` (that is the same check Android runs on its own every ~15 minutes).

## Gmail add-on demo, about 2 minutes

Needs these done beforehand, in your Google account (only you can do them):
- The tunnel is running and not expired (free tunnels last about 60 minutes and the address changes each time):
  `ssh -T -p 443 -R0:localhost:3000 a.pinggy.io`
- In the Apps Script project, the script property `SWIVEL_API` is set to the current tunnel address.
- Either `SWIVEL_TOKEN` is set (simplest), or the server was started with `GOOGLE_AUDIENCE=...` and your Gmail is linked once with a code from the app.
- A scam-looking email is in the inbox, and a normal one.

| Time | On screen | What to say |
|---|---|---|
| 0:00 | Gmail in the browser | The same protection works inside Gmail. |
| 0:10 | Open the scam email, SwivProtect panel | One click. It names the scam, shows the warning words it found and what to do, in the user's language. |
| 0:50 | Open the normal email | A normal email gets a green "nothing obviously wrong". |
| 1:10 | Short moment on the privacy line | It only reads the email you open, and nothing is stored. It asks for the narrowest permission Gmail offers. |
| 1:30 | Optional: first-time link card | The first time, you type a short code from the app to link your Gmail. After that it is automatic. |

If anything fails, switch to key mode (`SWIVEL_TOKEN`). It has the fewest moving parts.

## Presenter cheat sheet

### What you actually need to know
You do not need to know the files. You need to be able to explain the **product, the flow and the limits**, and to point at where things live if asked.

**One-minute explanation:** Scam waves hit older adults in clusters, and the usual protection reacts after money is lost. SwivProtect works in three moments.
*Before:* when 5 nearby, similar people report the same scam, everyone like them is warned in their language, with the words to look for.
*During:* a scam text or email is checked the moment it arrives and the person sees what it is and what to do.
*After:* a 4-tap report, recovery steps if they lost money, and the report helps warn the next person.

**If asked "how is it built", the six things worth recognizing:**
- `data/catalog.json`: the list of 20 scam types, warning words in 5 languages, and tips. Updated like patch notes.
- `server.js`: the server. Accounts, reports, the "5 people" alert rule, and the message check.
- `public/index.html`: every screen. The Android app shows these same screens.
- `android/`: the phone app. `SmsReceiver` checks texts, `AlertCheckJob` checks for alerts in the background.
- `googleAuth.js`: lets the Gmail add-on prove who you are without a password.
- `data/*.db`: two small databases. `docs/ERD-detailed.md` is the picture.

### Say these limits yourself, before anyone asks
- Detection is **rules and word lists, not AI**. That is deliberate: predictable, explainable, private, free per message.
- The data you show is **demo data**. The 20 scam types are: 5 from the FTC's 2024 text-scam report, 3 from the FBI's phishing categories (that page could not be opened to double-check them), and 12 from general scam knowledge.
- **Text checking is Android only.** The web app and the Gmail add-on work in any browser, but automatic text checking needs the Android app.
- The Gmail add-on is a **test install** in one account. Public release needs Google's review.
- Alerts to a **closed** app can be up to ~15 minutes late. Instant delivery needs Google's push service (next step).
- Reports are not identity-verified yet (one report per person per scam, plus caps).

### Questions you are likely to get
1. **How does it detect a scam?** It looks for warning words from the scam catalog. Three different words is high risk, two is medium. It tells you which words it found.
2. **Why not use AI?** Predictable and explainable for older users, no message leaves the phone except its text, no per-message cost. AI could explain results later (a small version is built but switched off).
3. **What about privacy?** Only the text of messages from numbers not in your contacts is sent, never the number, and it is not stored. Saved contacts are never checked. Reports carry no name. The Gmail add-on reads only the email you open.
4. **What triggers an alert?** 5 different people report the same scam within 30 days and share a state, an age range or a language. Reports and alerts delete themselves after 30 days.
5. **Could someone fake reports?** Partly mitigated (one per person per scam, caps). No identity check yet; that is a roadmap item.
6. **Who is it for?** Older adults: big text, few choices at once, 5 languages, no jargon.
7. **Would it scale?** Today it is one small server and SQLite. The next steps are a hosted database and push notifications.
8. **Did you build this yourself?** If you used an AI coding assistant, say so plainly and be ready to explain each part in your own words. That is respected far more than being caught out.

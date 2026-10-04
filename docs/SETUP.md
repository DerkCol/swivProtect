# Setup for teammates

## Run it
You need Node 24 or newer and Python 3. For the phone app you also need Android Studio.

```
npm run setup     # once: builds the scam catalog database
npm start         # http://localhost:3000
npm test          # 47 automated tests
```
To put it on a real server: `docs/DEPLOY.md`, or on Amazon Web Services `docs/DEPLOY-AWS.md`.
Read next: `docs/HANDOFF.md` (what exists and why), `docs/DEMO.md` (how to demo it), `docs/ERD-detailed.md` (the database).

## What is private, and where it lives
This repository is public on purpose, so these things are **not** in it:

| Private thing | Why | Where to get it |
|---|---|---|
| `public/swivel-logo.svg` | Swivel's registered logo | The **private kit** (a separate private repository, see below) |
| `data/live.db` | accounts and reports, including login keys | Never shared. Make your own: `npm run reset`, then `npm run demo` |
| API keys, login keys, tunnel addresses, Google account access | secrets | A password manager or the owner. Never in git, not even a private repository |
| Recordings, the transcript export, debug APKs | large or sensitive | Shared drive |

Without the logo the app still works and shows a plain "SwivProtect" title.

**The private kit:** ask the project owner for access to the private repository (`SwivProtect-private`). Clone it into a folder called `private` inside this project (this repository ignores that folder, so it can never be pushed here by accident) and run its installer:
```
git clone <private repository address> private
cd private && ./install.sh
```

## Settings (environment variables)
| Name | What it does |
|---|---|
| `PORT` | server port, default 3000 |
| `HOST` | address to listen on. Leave unset for development; on a real server set `127.0.0.1` so only the HTTPS front end can reach it (see `docs/DEPLOY.md`) |
| `GOOGLE_AUDIENCE` | turns on Gmail add-on sign-in; the OAuth client ID(s) the add-on's token is issued to |
| `TRUST_PROXY=1` | behind a proxy or tunnel that sets `X-Forwarded-For`, so rate limits tell people apart |
| `RATE_LIMITS` | `'{"signupIp":5}'` changes a limit; `off` disables all (development only) |
| `MAX_BODY_BYTES` | largest request accepted, default 100000 |
| `LINK_CODE_TTL_SECONDS` | how long a Gmail link code lasts, default 600 |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` | optional plain-language explanation of scam checks (off unless the key is set) |
| `SWIVEL_DATA_DIR`, `GOOGLE_JWKS_URL` | used by the tests |

## Never commit
`data/live.db`, anything with a key or token in it, tunnel addresses, `.env` files, recordings, `*.apk`. The ignore list already blocks the common ones, but check `git status` before every commit.

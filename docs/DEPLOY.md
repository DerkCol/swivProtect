# Putting SwivProtect on the group's server

This guide assumes a **Linux server (Ubuntu or Debian)** that you can log in to with `ssh` and run `sudo` on, and a **domain name** you can point at it.
The commands are the standard ones from each vendor, but they have **not been run on your server**, so read each result and tell someone if it differs.
If your server is something else (Windows, a shared host with no root, or a service like Render or Railway), see the last section.

## Why these pieces
- **Node 24** runs the server. Nothing else is needed: no database program (the data is one file) and no Python (the scam catalog database is already in the repository).
- **systemd** keeps it running, restarts it after a crash, and starts it when the server boots.
- **Caddy** sits in front and handles **HTTPS** by itself. HTTPS is not optional: the phone app only talks plain `http` to the developer's own computer, the Gmail add-on needs `https`, and browsers need it to install the app and show notifications.
- **Run exactly one copy.** The limits and link codes live in the program's memory and the database is a single file. Two copies would give wrong results.

## What you need first
1. SSH access with `sudo` to the server.
2. A domain name for the app, for example `swivprotect.yourdomain.org`, with an **A record** pointing to the server's public IP address.
3. Ports **80 and 443** reachable from the internet (and 22 for you). Nothing else should be open.
4. About 512 MB of free memory and 1 GB of disk. That is plenty.

## If you use GoDaddy
GoDaddy sells several different things, and only some of them can run SwivProtect. Check **My Products** in your GoDaddy account:

| What you see | Does it work? |
|---|---|
| **VPS Hosting** (a Linux server with root access), set up with a plain Ubuntu or "OS only" template | Yes. Follow this guide. Also open ports **80 and 443** in GoDaddy's own firewall settings for the VPS (in its control panel), as well as `ufw` in step 1. |
| **VPS with the cPanel / WHM template** | Not as is. Apache already uses ports 80 and 443, so Caddy cannot start. Re-install the VPS with the plain Ubuntu template (this erases it), or ask for help putting Node behind Apache. |
| **Web Hosting (cPanel, "shared" hosting)** | No. You get no root access and cannot keep a program running. Some plans have a "Setup Node.js App" tool, but its Node is usually too old (this server needs Node 22.13 or newer for its built-in database). Use a VPS instead. |
| **Website Builder or Managed WordPress** | No. |
| **Only a domain name** (no hosting) | Fine. The domain is all GoDaddy needs to do (below); the server can be anywhere. |

**Pointing your domain at the server** (this replaces whatever the guide says about "an A record"):
1. In GoDaddy: **My Products**, find the domain, click **DNS** (or "Manage DNS").
2. Click **Add New Record**. Type **A**, Name **swivprotect** (that makes `swivprotect.yourdomain.com`), Value **the server's public IP address**, TTL **600 seconds** (or the shortest offered). Use a subdomain like this so your existing website is untouched.
3. If a record with the same Name already exists (a `CNAME`, or an `A` pointing somewhere else), delete it. Turn off "Domain Forwarding" for that name if it is on.
4. Wait a few minutes, then check from your Mac: `dig +short swivprotect.yourdomain.com` must print the server's IP address. If it prints nothing, wait longer. If it prints a different address, fix the record.
5. Do **not** buy a GoDaddy SSL certificate. Caddy gets a free one automatically.
6. Look for a **CAA** record in the DNS list. If one exists and does not mention `letsencrypt.org`, certificate issuance will fail: delete it or add one with value `0 issue "letsencrypt.org"`.

## 1. Prepare the server
```
sudo apt update && sudo apt upgrade -y
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
sudo adduser --system --group --home /opt/swivprotect swivprotect
```

## 2. Install Node 24
```
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version      # should say v24 or newer
which node          # should be /usr/bin/node (if not, edit ExecStart in the service file)
```

## 3. Get the code onto the server
Option A, from GitHub (once the public repository is pushed):
```
sudo apt-get install -y git
sudo -u swivprotect git clone https://github.com/DerkCol/SwivProtect.git /opt/swivprotect
```
Option B, copy from your Mac (works before anything is on GitHub). Run this **on your Mac**:
```
rsync -av --exclude .git --exclude node_modules --exclude 'data/live.db*' --exclude private --exclude .tools \
  --exclude 'android/app/build' --exclude 'android/.gradle' ~/swivel/ <you>@<server>:/tmp/swivprotect/
```
then **on the server**: `sudo rsync -a /tmp/swivprotect/ /opt/swivprotect/ && sudo chown -R swivprotect:swivprotect /opt/swivprotect`

The Swivel logo is private. Copy it separately (or skip it and the app shows a plain title). From your Mac:
```
scp ~/swivel/private/assets/swivel-logo.svg <you>@<server>:/tmp/ && ssh <you>@<server> 'sudo install -o swivprotect -g swivprotect /tmp/swivel-logo.svg /opt/swivprotect/public/swivel-logo.svg'
```

## 4. Settings
```
sudo cp /opt/swivprotect/deploy/swivprotect.env.example /etc/swivprotect.env
sudo chmod 640 /etc/swivprotect.env && sudo chown root:swivprotect /etc/swivprotect.env
sudo nano /etc/swivprotect.env       # leave PORT, HOST and TRUST_PROXY as they are
```
`HOST=127.0.0.1` means the program answers only to Caddy on the same machine. `TRUST_PROXY=1` is only safe together with that, because it makes the program believe the visitor address Caddy reports.

## 5. Start it
```
sudo cp /opt/swivprotect/deploy/swivprotect.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now swivprotect
sudo systemctl status swivprotect          # should say "active (running)"
curl http://127.0.0.1:3000/healthz         # should print: ok
```
The first start creates `data/live.db` by itself. (A line about SQLite being "experimental" in the log is normal.)

## 6. Add HTTPS with Caddy
```
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
sudo cp /opt/swivprotect/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile            # replace swivprotect.example.org with your domain
sudo systemctl reload caddy
```
Caddy fetches the certificate on the first visit. If it cannot, the cause is almost always that the domain does not point at this server yet, or ports 80/443 are blocked.

## 7. Check it from your own computer
```
curl https://<your domain>/healthz            # ok
curl -I https://<your domain>/api/options     # 200, with x-frame-options and no access-control-allow-origin
```
Then open `https://<your domain>` in a browser and create an account. Also confirm the direct port is closed: `curl http://<server ip>:3000/healthz` from your computer must **fail**.

## 8. Point the apps at it
- **Android app.** Install the APK. On first launch it cannot reach its default address and shows a screen asking for one: type `https://<your domain>` and tap Try again. It remembers it. (Making that address the default needs a rebuild; ask for the build option.)
- **Gmail add-on.** In the Apps Script project set the script property `SWIVEL_API` to `https://<your domain>` (no slash at the end), and add your domain to `urlFetchWhitelist` in `appsscript.json`, for example `"https://swivprotect.yourdomain.org/"`.
  For Google sign-in: set `SWIVEL_DEBUG` to `1`, open the add-on's home card, copy the **Audience** value, put it in `/etc/swivprotect.env` as `GOOGLE_AUDIENCE=...`, then `sudo systemctl restart swivprotect`. Turn `SWIVEL_DEBUG` off afterwards.
- Anything that used a temporary tunnel address can now use this permanent one.

## Running it day to day
| Task | Command |
|---|---|
| See the log | `sudo journalctl -u swivprotect -f` |
| Restart | `sudo systemctl restart swivprotect` (also clears the in-memory limits) |
| Update to new code | `cd /opt/swivprotect && sudo -u swivprotect git pull && sudo systemctl restart swivprotect` |
| Back up the data | `sudo /opt/swivprotect/deploy/backup.sh` (needs `sudo apt install -y sqlite3`) |
| Back up every night | `echo '0 3 * * * root /opt/swivprotect/deploy/backup.sh' \| sudo tee /etc/cron.d/swivprotect-backup` |

Copy backups off the server now and then. They contain hashed passwords and login keys, so keep them private.

## Do not
- **Do not run `npm run reset` on the server.** It deletes every real account.
- Do not open port 3000 in the firewall, and do not remove `HOST=127.0.0.1` while `TRUST_PROXY=1` is set.
- Do not put keys in any file in the repository. Keys go in `/etc/swivprotect.env` only.
- Do not run `npm run demo` against the live server: it creates fake accounts.
- Do not run two copies.

## When something goes wrong
| What you see | Likely cause and fix |
|---|---|
| Browser says "502 Bad Gateway" | The program is not running. `sudo systemctl status swivprotect` and read the log. |
| No certificate / browser warning | The domain does not point at the server yet, or ports 80/443 are closed. `sudo journalctl -u caddy -n 50` |
| "Too many requests" for everyone | `TRUST_PROXY=1` or the proxy is missing, so everyone shares one address. Check the env file, then restart. |
| The phone app says it cannot reach the server | The address is wrong, or it starts with `http://` instead of `https://`. |
| Gmail card says "Gmail sign-in is off" | `GOOGLE_AUDIENCE` is not set (or the service was not restarted after setting it). |
| Gmail card says "Google sign-in not accepted" | `GOOGLE_AUDIENCE` does not match the add-on. The log line says which audience it saw: `journalctl -u swivprotect -n 20`. |

## If your server is not Ubuntu or Debian
- **Windows server or macOS:** run `node server.js` with the same settings through a service manager (NSSM on Windows, launchd on macOS), and put any HTTPS-capable proxy (Caddy runs on both) in front. The rules above still apply.
- **Shared hosting without root:** it will not work; Node servers need a machine you control.
- **Render, Railway, Fly.io and similar:** use `node server.js` as the start command, mount a **persistent disk** at the `data` folder (the database is a file and would be lost on every restart otherwise), set `TRUST_PROXY=1`, do not set `HOST`, and run a single instance. They provide HTTPS for you.
- **A university or company machine behind a firewall:** you need someone with admin rights to open ports 80 and 443 and to give you a domain name. Ask them for exactly that.

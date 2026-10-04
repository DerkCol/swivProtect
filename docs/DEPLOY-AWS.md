# Hosting SwivProtect on AWS, from the AWS console

This is the whole path, using only the AWS web console (the "dashboard") and a browser terminal. No command-line tools are needed on your own computer except to build the zip.
AWS changes its screens and prices from time to time, and this guide was written without seeing your console, so if a label differs slightly, look for the closest one. Prices below are rough: check the AWS pricing page.

## 0. Which AWS service
SwivProtect is **one small program plus one database file**. That fits **one small server**, not the services that replace servers automatically.

| Service | Verdict |
|---|---|
| **EC2** (a configurable server, works on all AWS accounts including school provisioned) | **Use this.** Works on restricted accounts. Pay-as-you-go. t3.micro or t3.small (about $0.01/hour). |
| **Amazon Lightsail** (a simple server with a fixed monthly price) | Easiest console if available, about $5 to $7 a month. See section 12 if your account allows it. |
| **Elastic Beanstalk** | Looks tempting because it accepts a zip, but it replaces servers when it updates or scales, which **wipes the database file**, and HTTPS needs an extra load balancer (about $16 a month more). Avoid. |
| **App Runner, ECS/Fargate, Lambda, Amplify** | Not suitable: no permanent disk for the database file. |

## 1. Before you start (15 minutes)
1. **An AWS account** (you have this; it's school provisioned).
2. **Check what you can do:** try to find EC2 in the console (search **EC2**). If you see it, continue. If the console says access is denied, contact your school's AWS administrator. (Lightsail may not be available, but EC2 usually is.)
3. **Choose a region** (top right of the console), for example **US East (N. Virginia)** if your school allows it, and use the same one for everything below.
4. **A domain name.** HTTPS needs one. If it is at GoDaddy, see "If you use GoDaddy" in `DEPLOY.md`; the only AWS-side fact you need is the server's fixed IP address from section 4. No domain? Buy a cheap one (Route 53 or GoDaddy), or use a free name from duckdns.org pointed at the fixed IP.
5. **Build the zip** on your Mac (it contains only what the server needs, never the database or keys):
   ```
   cd ~/swivel && deploy/make-zip.sh
   ```
   That creates `dist/swivprotect-deploy.zip`. It includes the private Swivel logo, so keep it private. Use `deploy/make-zip.sh --no-logo` if the zip will leave the team.

## 2. Upload the zip to S3 and make a one-time download link
The server will download the zip from this link, so you never have to copy files through a terminal.
1. Console, search **S3**, **Create bucket**. Give it a unique name such as `swivprotect-deploy-<something>`, the same region, and leave **Block all public access ON**.
2. Open the bucket, **Upload**, add `dist/swivprotect-deploy.zip`, **Upload**.
3. Click the uploaded file, **Object actions**, **Share with a presigned URL**, set **30 minutes**, **Create**, and **copy the link**. Keep it handy; it stops working after 30 minutes (make a new one if needed).

## 3. Create an EC2 instance
1. Console, search **EC2**, **Launch instance**.
2. Name: `swivprotect`. Image: **Ubuntu Server 24.04 LTS**. Instance type: **t3.micro** (1 GB, $0.01/hour) or **t3.small** if you want more headroom.
3. Key pair: **Create new key pair**, name `swivprotect`, **Create**. A `.pem` file downloads. Keep it safe (it's your password to the server).
4. Network settings: **Auto-assign public IP: Enable**, then **Edit** security group: **Allow SSH from: My IP** (fills your address), then **Add rule** for **HTTP** (port 80, anywhere) and **HTTPS** (port 443, anywhere). Do not open port 3000.
5. Storage: 20 GB is fine. **Launch instance**, wait until Status is **Running** and Status checks both say **Passed** (about 1 minute).

## 4. Give it a fixed public address and connect
1. Console, **Instances**, click your `swivprotect` instance, **Details** tab, **Public IPv4 address**. **Write this down.** (AWS charges for public IPs that are not attached, so do step 6 soon.)
2. Click **Elastic IPs** on the left, **Allocate Elastic IP**, tag it `swivprotect`, **Allocate**. Then **Associate this Elastic IP**, choose your instance and its private address, **Associate**. (Now the public IP is free while attached to your instance.)

## 5. Point your domain at the fixed IP
In your domain's DNS (GoDaddy: My Products, DNS), add an **A record**: name `swivprotect`, value = the **Elastic IP** from step 4, shortest TTL. Check from your Mac after a few minutes: `dig +short swivprotect.yourdomain.com` should print that IP.

## 6. Open a terminal on the server
Console, **Instances**, click your instance, **Connect**, tab **EC2 Instance Connect**, **Connect**. A browser terminal opens as `ubuntu`. Everything below is typed there.
(Alternatively, from your Mac: `ssh -i /path/to/swivprotect.pem ubuntu@<public-ip>`, but the browser terminal is simpler.)

## 7. Install and start SwivProtect
Paste these, in order. Replace `PASTE-THE-LINK-HERE` with the presigned URL from step 2 (keep the quotes).
```
sudo apt update && sudo apt upgrade -y
sudo apt-get install -y curl unzip rsync sqlite3
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
```
`node --version` must say **v24** (v22.13 or newer also works).
```
sudo adduser --system --group --home /opt/swivprotect swivprotect
curl -fL -o /tmp/swivprotect.zip 'PASTE-THE-LINK-HERE'
rm -rf /tmp/sp && mkdir /tmp/sp && unzip -q /tmp/swivprotect.zip -d /tmp/sp
sudo rsync -a /tmp/sp/swivprotect/ /opt/swivprotect/
sudo chown -R swivprotect:swivprotect /opt/swivprotect
rm -rf /tmp/sp /tmp/swivprotect.zip
```
Now the settings and the service:
```
sudo cp /opt/swivprotect/deploy/swivprotect.env.example /etc/swivprotect.env
sudo chmod 640 /etc/swivprotect.env && sudo chown root:swivprotect /etc/swivprotect.env
sudo cp /opt/swivprotect/deploy/swivprotect.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now swivprotect
sudo systemctl status swivprotect --no-pager
curl http://127.0.0.1:3000/healthz
```
The status must say **active (running)** and the last command must print **ok**. (The settings file already has the right values: `HOST=127.0.0.1` and `TRUST_PROXY=1`.) If not, see the troubleshooting table.

## 8. Add HTTPS
```
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```
Then write the front-end settings, **with your own domain in the first line**:
```
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
swivprotect.yourdomain.com {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}
EOF
sudo systemctl reload caddy
```
Caddy gets the certificate by itself on the first visit. It can only do that once the DNS record from step 5 is working.

## 9. Check that it is live
From your own computer:
```
curl https://swivprotect.yourdomain.com/healthz              # ok
curl -I https://swivprotect.yourdomain.com/api/options       # HTTP 200, no access-control-allow-origin line
curl -m 5 http://<static IP>:3000/healthz                    # must FAIL (port 3000 is closed)
```
Then open `https://swivprotect.yourdomain.com` in a browser and create an account.

## 10. Point the apps at it
- **Android app:** on first launch it asks for the server address: type `https://swivprotect.yourdomain.com` and tap Try again.
- **Gmail add-on:** set the script property `SWIVEL_API` to `https://swivprotect.yourdomain.com` (no slash at the end) and add `"https://swivprotect.yourdomain.com/"` to `urlFetchWhitelist` in `appsscript.json`. For Google sign-in, follow "Gmail add-on" in `DEPLOY.md`.

## 11. Day-to-day
| Task | How |
|---|---|
| See the log | `sudo journalctl -u swivprotect -f` (in the browser terminal) |
| Restart | `sudo systemctl restart swivprotect` |
| Deploy a new version | Build a new zip, upload it to S3, make a new presigned link (section 2), then in the server terminal: `curl -fL -o /tmp/swivprotect.zip 'NEW-LINK'`, `rm -rf /tmp/sp && mkdir /tmp/sp && unzip -q /tmp/swivprotect.zip -d /tmp/sp`, `sudo systemctl stop swivprotect`, `sudo rsync -a --exclude 'data/live.db*' /tmp/sp/swivprotect/ /opt/swivprotect/`, `sudo chown -R swivprotect:swivprotect /opt/swivprotect`, `sudo systemctl start swivprotect`, `rm -rf /tmp/sp /tmp/swivprotect.zip`. The exclusion keeps your real accounts. |
| Back up the data | Lightsail, your instance, **Snapshots**, **Enable automatic snapshots** (a daily copy of the whole server). Also `sudo /opt/swivprotect/deploy/backup.sh` for a copy of just the database. |
| Stop paying | Delete the instance, **and** the static IP, and the S3 zip. |

## 12. Lightsail instead of EC2 (if your account allows it)
If Lightsail is available on your account, it is slightly simpler: console **Lightsail**, **Create instance**; region: the same one; blueprint: **OS Only**, **Ubuntu 24.04 LTS**; plan: **1 GB**; name `swivprotect`; **Create**. Then **Networking**, **Create static IP**, attach it to `swivprotect`. Click the instance, **IPv4 Firewall**, add **HTTP** (80) and **HTTPS** (443). Click **Connect using SSH** (orange button), and continue from section 7 above. Lightsail's fixed price (about $5–7 a month) may be cheaper than EC2's hourly rate if it is running long-term.

## 13. When something goes wrong
| What you see | Likely cause and fix |
|---|---|
| `curl` for the zip says 403 or "expired" | The presigned link ran out (30 minutes). Make a new one (section 2). Quote it with single quotes. |
| `systemctl status` says failed | `sudo journalctl -u swivprotect -n 40`. Most often Node is too old (`node --version`) or the zip was unpacked into the wrong folder (`ls /opt/swivprotect` must show `server.js`). |
| Browser: 502 Bad Gateway | The program is not running. Same fix as above. |
| Browser cannot connect at all | The HTTP/HTTPS firewall rules (section 4) are missing, or the DNS record is wrong. |
| No certificate or a browser warning | DNS does not point at the static IP yet (`dig +short ...`), or port 80 is closed. `sudo journalctl -u caddy -n 50` |
| "Too many requests" for everyone | `TRUST_PROXY=1` is missing from `/etc/swivprotect.env`, or Caddy is not in front. Fix, then `sudo systemctl restart swivprotect`. |
| Everything froze or was killed during install | The 512 MB plan ran out of memory. Use the 1 GB plan. |

## Do not
- Do not run `npm run reset` on the server: it deletes every real account.
- Do not open port 3000, and do not remove `HOST=127.0.0.1` while `TRUST_PROXY=1` is set.
- Do not put keys into the zip or the repository. Keys go in `/etc/swivprotect.env` on the server only.
- Do not run two copies of the server, and do not use Elastic Beanstalk or any service that replaces servers: the database is a file on this one machine.
- Do not leave the presigned link or the zip lying around: delete the S3 file when you are done if it holds the private logo.

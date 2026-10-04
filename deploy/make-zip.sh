#!/bin/sh
# Builds dist/swivprotect-deploy.zip: only what the server needs, and nothing private except (optionally) the logo.
# Usage: deploy/make-zip.sh [--no-logo]
#   --no-logo   leave the private Swivel logo out (use this if the zip will be shared outside the team)
set -e
cd "$(dirname "$0")/.."
ROOT=$(pwd)
OUT=dist/swivprotect-deploy.zip
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
D="$STAGE/swivprotect"
mkdir -p "$D/data" "$D/deploy" "$D/docs"
cp server.js googleAuth.js recovery.js package.json "$D/"
cp data/catalog.db data/live_schema.sql "$D/data/"            # the scam catalog; live.db is created on first start and is never packed
cp -R public "$D/public"
cp deploy/swivprotect.service deploy/swivprotect.env.example deploy/Caddyfile deploy/backup.sh "$D/deploy/"
cp docs/DEPLOY.md docs/DEPLOY-AWS.md docs/SETUP.md "$D/docs/"
if [ "$1" = "--no-logo" ] || [ ! -f public/swivel-logo.svg ]; then
  rm -f "$D/public/swivel-logo.svg"; echo "Logo NOT included (the app will show a plain title)."
else
  echo "Logo included: keep this zip private (a private S3 bucket is fine)."
fi
mkdir -p dist && rm -f "$OUT"
(cd "$STAGE" && zip -qr "$ROOT/$OUT" swivprotect)
# refuse to leave behind a zip that holds anything it should not
if unzip -Z1 "$OUT" | grep -E 'live\.db|\.env$|/\.git/|/private/|\.apk$|node_modules|\.pem$|\.keystore$'; then echo "STOP: the zip contains a private file (listed above)."; rm -f "$OUT"; exit 1; fi
echo "Built $OUT ($(du -h "$OUT" | cut -f1), $(unzip -Z1 "$OUT" | grep -vc '/$') files)"

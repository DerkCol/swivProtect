#!/bin/sh
# A safe copy of the live database (works while the server is running). Keeps the newest 30.
# Usage: ./backup.sh [folder]      Needs the sqlite3 tool: sudo apt install -y sqlite3
# The copy holds hashed passwords and login keys, so it is readable only by its owner. Keep it off public places.
set -e
APP=${APP:-/opt/swivprotect}
DEST=${1:-/var/backups/swivprotect}
umask 077
mkdir -p "$DEST"
STAMP=$(date +%F-%H%M)
sqlite3 "$APP/data/live.db" ".backup '$DEST/live-$STAMP.db'"
ls -1t "$DEST"/live-*.db | tail -n +31 | xargs -r rm --
echo "Saved $DEST/live-$STAMP.db"

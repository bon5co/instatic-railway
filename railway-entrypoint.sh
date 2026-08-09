#!/bin/sh
# Repair the volume's ownership as root, drop back to the image's own `bun`
# user, seed the owner account, then hand over to the stock CMD.
#
# Railway mounts a volume owned by uid 0 while this image runs as uid 1000, so
# something has to repair it. The vendor's listing does that by publishing
# RAILWAY_RUN_UID=0 — which both runs the whole CMS as root and, because a
# literal-valued template variable is dropped at generate time, publishes as a
# blank REQUIRED field the deployer is asked to fill in. Doing it here costs the
# deployer nothing and keeps the app unprivileged.
set -e

MOUNT=${INSTATIC_STORAGE_DIR:-/app/storage}
APP_UID=1000
APP_GID=1000

# Fail before doing any work — an unclaimed Instatic on a public URL is
# takeable by any stranger, so booting without a password is never the helpful
# option. (The seed re-checks; this keeps the message first in the deploy log.)
if [ -z "$INSTATIC_ADMIN_PASSWORD" ]; then
  echo "[railway] INSTATIC_ADMIN_PASSWORD is empty. Refusing to boot: an unclaimed" >&2
  echo "[railway] Instatic on a public URL can be claimed by anyone with the link," >&2
  echo "[railway] who becomes its owner and locks you out. Set it and redeploy." >&2
  exit 1
fi

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$MOUNT/data" "$MOUNT/uploads" "$MOUNT/runtime-cache"
  chown -R "$APP_UID:$APP_GID" "$MOUNT"
  echo "[railway] storage owner=$(stat -c %u:%g "$MOUNT") (repaired as root)"
  exec setpriv --reuid="$APP_UID" --regid="$APP_GID" --init-groups "$0" "$@"
fi

echo "[railway] running as uid=$(id -u) gid=$(id -g), storage owner=$(stat -c %u:%g "$MOUNT")"

cd /app
bun /app/railway-seed.ts

exec "$@"

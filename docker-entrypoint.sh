#!/bin/sh
# Runs as root (the image's default user, so this needs no host-specific
# config like Railway's RAILWAY_RUN_UID). Whatever got attached at /data —
# a Railway volume, a Fly volume, a `docker run -v`, a fresh empty dir — is
# very often root-owned regardless of what built the image, so claim it for
# the app user before the app ever touches it. Cheap and idempotent for a
# SQLite file at this app's scale; safe to run on every start.
set -e
chown -R node:node /data
exec gosu node "$@"

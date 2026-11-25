#!/bin/sh
# propi-server container entrypoint.
#   RUN_MIGRATIONS=true  runs `prisma migrate deploy` first.
#   `migrate`            only migrates, then exits 0 (the stack's one-shot migrate service).
#   anything else        is passed to apps/server/src/main.ts (default: serve).
set -eu
if [ "${RUN_MIGRATIONS:-false}" = "true" ] || [ "${1:-}" = "migrate" ]; then
  echo "running prisma migrate deploy"
  (cd /repo/packages/db && ./node_modules/.bin/prisma migrate deploy)
fi
if [ "${1:-}" = "migrate" ]; then exit 0; fi
exec node /repo/apps/server/src/main.ts "$@"

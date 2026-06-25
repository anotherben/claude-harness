#!/usr/bin/env bash
# bug-factory DEV DB resolver — sets TEST_DATABASE_URL to the real dev DB (helpdesk_dev), NEVER prod.
#
# WHY: root /Users/ben/helpdesk/.env DATABASE_URL = PROD htnhelpdesk (confirmed 2026-05-30).
# apps/api/.env DATABASE_URL = drifted local cortex_local. The real dev DB (helpdesk_dev) is a
# SEPARATE Render host whose creds live in /Users/ben/.htn-dev-canary.creds.
#
# USAGE (subagents + orchestrator):  . devdb-env.sh || { echo "dev-db guard failed"; exit 1; }
# Then run jest / psql against "$TEST_DATABASE_URL". Fails closed if it ever resolves to prod.

set -a; . /Users/ben/.htn-dev-canary.creds 2>/dev/null; set +a
export TEST_DATABASE_URL="${TEST_DATABASE_URL:-${DEV_DATABASE_URL:-${DATABASE_URL:-}}}"
case "$TEST_DATABASE_URL" in
  *helpdesk_dev*) : ;;
  *) echo "ABORT (prod-safety guard): TEST_DATABASE_URL did not resolve to helpdesk_dev — refusing to run."; return 1 2>/dev/null || exit 1 ;;
esac

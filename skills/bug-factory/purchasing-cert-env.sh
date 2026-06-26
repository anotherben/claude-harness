#!/usr/bin/env bash
# bug-factory PURCHASING-CERT env resolver — loads the dev/test credentials needed by the
# purchasing dev-canary certification pack (PC-LIVE-DB receipt etc.) and the live REX canaries.
#
# Source of values: /Users/ben/.htn-purchasing-cert.creds (provided by Ben 2026-06-10; chmod 600).
# DEV/TEST ONLY: REX = testhuntthenight (test instance), DB = helpdesk_dev. NEVER prod htnhelpdesk.
#
# USAGE:  . purchasing-cert-env.sh || { echo "cert env guard failed"; exit 1; }
# Fails closed if REX_API_KEY is missing or the DB does not resolve to helpdesk_dev.

set -a; . /Users/ben/.htn-purchasing-cert.creds 2>/dev/null; set +a

# Fail-closed guards — never run cert/canaries against the wrong system.
case "$DATABASE_URL" in
  *helpdesk_dev*) : ;;
  *) echo "ABORT (cert-env guard): DATABASE_URL did not resolve to helpdesk_dev."; return 1 2>/dev/null || exit 1 ;;
esac
case "$TEST_DATABASE_URL" in
  *helpdesk_dev*) : ;;
  *) echo "ABORT (cert-env guard): TEST_DATABASE_URL did not resolve to helpdesk_dev."; return 1 2>/dev/null || exit 1 ;;
esac
[ -n "$REX_API_KEY" ] || { echo "ABORT (cert-env guard): REX_API_KEY missing."; return 1 2>/dev/null || exit 1; }
case "$REX_WEBSTORE_URL" in
  *testhuntthenight*) : ;;
  *) echo "ABORT (cert-env guard): REX_WEBSTORE_URL is not the testhuntthenight dev instance."; return 1 2>/dev/null || exit 1 ;;
esac

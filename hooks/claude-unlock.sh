#!/bin/bash
# claude-unlock — Generate a one-time elevation code for agent infrastructure access
# Usage: claude-unlock
#
# Prints a 6-digit code. The agent must include this code to write to protected files.
# Code expires after 10 minutes. Single use — burned after one successful verification.

CODE=$(python3 -c "import random; print(f'{random.randint(100000,999999)}')")
EXPIRY=$(date -v+10M +%s 2>/dev/null || date -d '+10 minutes' +%s 2>/dev/null)
ELEVATE_FILE="/tmp/claude-unlock"

echo "${CODE}|${EXPIRY}" > "$ELEVATE_FILE"
chmod 600 "$ELEVATE_FILE"

echo ""
echo "  Elevation code: ${CODE}"
echo "  Expires: 10 minutes"
echo "  Single use — burned after one write operation"
echo ""
echo "  Give this code to the agent when it asks for elevation."
echo ""

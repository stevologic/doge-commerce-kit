#!/usr/bin/env bash
#
# Continuous deploy for doge-commerce-kit.
#
# Operates on the directory THIS script lives in (the repo root) — no hardcoded
# paths. Fetches the tracked branch and rebuilds the containers whenever the
# branch tip differs from the commit that was last built (tracked in
# .deploy.last), so a manual `git pull` that never rebuilt still deploys. Safe to
# run from cron every few minutes: with nothing new it logs one line and exits.
#
#   Setup on the server:
#     chmod +x deploy.sh
#     ./deploy.sh                      # run once to verify it works
#     crontab -e                       # (use `sudo crontab -e` if Docker needs root)
#       */5 * * * * /full/path/to/doge-commerce-kit/deploy.sh >/dev/null 2>&1
#
#   Options / overrides:
#     ./deploy.sh --force              # rebuild even if there is no new commit
#     DEPLOY_BRANCH=main               # branch to track (default: main)
#     DEPLOY_LOG=/var/log/deploy.log   # log path (default: <repo>/deploy.log)
#
# Note: the server working tree is treated as a disposable mirror of the repo.
# `git reset --hard` + `git clean -fd` discard any local edits on the server.
# Gitignored files (.env, deploy.log, the lock file, staticfiles/) are preserved.

set -euo pipefail

# --- locate the repo (this script's own directory) --------------------------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
cd "$SCRIPT_DIR"

BRANCH="${DEPLOY_BRANCH:-main}"
LOG_FILE="${DEPLOY_LOG:-$SCRIPT_DIR/deploy.log}"
LOCK_FILE="$SCRIPT_DIR/.deploy.lock"
STATE_FILE="$SCRIPT_DIR/.deploy.last"   # commit the running containers were built from
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
fail() { log "ERROR: $*"; exit 1; }

# --- keep the log bounded ----------------------------------------------------
if [ -f "$LOG_FILE" ] && [ "$(wc -l <"$LOG_FILE" 2>/dev/null || echo 0)" -gt 5000 ]; then
  tail -n 2000 "$LOG_FILE" >"$LOG_FILE.tmp" 2>/dev/null && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi

# --- single-instance lock (a slow build must not overlap the next cron tick) -
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  flock -n 9 || { log "Another deploy is already running; skipping this tick."; exit 0; }
fi

# --- pick docker compose v2, else legacy v1 ----------------------------------
if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose)
else
  fail "Docker Compose not found. Install Docker (https://get.docker.com)."
fi

# --- sanity checks -----------------------------------------------------------
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "not a git repository: $SCRIPT_DIR"
[ -f "$SCRIPT_DIR/.env" ] || log "WARNING: .env not found — the web container refuses to boot without DJANGO_SECRET_KEY (see .env.example)."

# --- is a rebuild needed? ----------------------------------------------------
# Compare the branch tip against the commit we last BUILT (not just against the
# local HEAD), so a manual `git pull` that never rebuilt still triggers a deploy.
log "=== Deploy check (branch: $BRANCH) ==="
git fetch --quiet origin "$BRANCH" || fail "git fetch failed."
REMOTE="$(git rev-parse "origin/$BRANCH")"
DEPLOYED="$(cat "$STATE_FILE" 2>/dev/null || echo none)"

if [ "$REMOTE" = "$DEPLOYED" ] && [ "$FORCE" -eq 0 ]; then
  log "Already deployed at ${REMOTE:0:8}. Nothing to do."
  exit 0
fi

# --- deploy ------------------------------------------------------------------
if [ "$FORCE" -eq 1 ]; then
  log "Forced rebuild at ${REMOTE:0:8}."
elif [ "$DEPLOYED" = "none" ]; then
  log "First deploy at ${REMOTE:0:8}."
else
  log "Deploying ${DEPLOYED:0:8} -> ${REMOTE:0:8}."
fi

git reset --hard "origin/$BRANCH"
git clean -fd   # drop untracked build cruft; gitignored files (.env, logs, .deploy.last) survive

log "Building and restarting containers..."
"${DC[@]}" up -d --build --remove-orphans >>"$LOG_FILE" 2>&1 || fail "docker compose build/up failed — see the log above."

# Record what we actually deployed, so the next run compares against it.
git rev-parse HEAD >"$STATE_FILE"

# --- best-effort health confirmation -----------------------------------------
sleep 5
if "${DC[@]}" ps --status running 2>/dev/null | grep -q .; then
  log "Containers running."
else
  log "WARNING: no running containers after deploy — check '${DC[*]} logs'."
fi

log "=== Deploy finished at $(git rev-parse --short HEAD) ==="

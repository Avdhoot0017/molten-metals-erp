#!/usr/bin/env bash
#
# Pull, migrate, build, restart.
#
# The ordering here is the whole point: the new build is produced BEFORE the
# running app is touched, so a broken commit or a failed migration leaves the
# current server up rather than taking the plant offline. Nothing stops until
# there is something working to start.
#
#   ./deploy.sh              pull main, migrate, build, restart
#   ./deploy.sh --help       every flag
#
set -Eeuo pipefail

# ---------------------------------------------------------------- settings

BRANCH="main"
PORT="${PORT:-3000}"
APP_NAME="molten-metal-erp"
DO_BUILD=1
DO_RESTART=1
DO_SEED=0
FORCE=0
DRY_RUN=0
HEALTH_TIMEOUT=90

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$REPO_ROOT/.deploy"
LOCK_FILE="$STATE_DIR/deploy.lock.d"
PID_FILE="$STATE_DIR/app.pid"
APP_LOG="$STATE_DIR/app.log"
DEPLOY_LOG="$STATE_DIR/deploy.log"

# ----------------------------------------------------------------- output

if [[ -t 1 ]]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
  BLUE=$'\033[34m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
else
  RED=""; GREEN=""; YELLOW=""; BLUE=""; DIM=""; BOLD=""; RESET=""
fi

_log()  { printf '%s%s%s %s\n' "$DIM" "$(date '+%H:%M:%S')" "$RESET" "$1"; }
step()  { printf '\n%s==>%s %s%s%s\n' "$BLUE" "$RESET" "$BOLD" "$1" "$RESET"; }
info()  { _log "$1"; }
ok()    { _log "${GREEN}✓${RESET} $1"; }
warn()  { _log "${YELLOW}!${RESET} $1"; }
die()   { printf '\n%s✗ %s%s\n' "$RED" "$1" "$RESET" >&2; exit 1; }

run() {
  if (( DRY_RUN )); then
    printf '%s   would run:%s %s\n' "$DIM" "$RESET" "$*"
    return 0
  fi
  "$@"
}

usage() {
  cat <<EOF
${BOLD}deploy.sh${RESET} - pull, migrate, build and restart ${APP_NAME}

  --branch <name>   Branch to deploy (default: ${BRANCH})
  --port <n>        Port to serve on (default: ${PORT})
  --seed            Run the database seed after migrating. Destructive:
                    the seed clears operational tables. Never automatic.
  --skip-build      Reuse the existing .next build
  --no-restart      Pull, migrate and build, but leave the running app alone
  --force           Redeploy even when already up to date, and stash local
                    changes instead of refusing to run
  --dry-run         Print what would happen, change nothing
  -h, --help        This message

Logs: ${DEPLOY_LOG#"$REPO_ROOT"/} (deploy) and ${APP_LOG#"$REPO_ROOT"/} (app)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)     BRANCH="${2:?--branch needs a name}"; shift 2 ;;
    --port)       PORT="${2:?--port needs a number}"; shift 2 ;;
    --seed)       DO_SEED=1; shift ;;
    --skip-build) DO_BUILD=0; shift ;;
    --no-restart) DO_RESTART=0; shift ;;
    --force)      FORCE=1; shift ;;
    --dry-run)    DRY_RUN=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    *)            usage; die "Unknown option: $1" ;;
  esac
done

cd "$REPO_ROOT"
mkdir -p "$STATE_DIR"

# The state directory ignores itself, so the script's own logs and pid file can
# never make the working tree look dirty and block the next deploy. Doing it
# here rather than relying on the repo .gitignore means it holds on a fresh
# clone too, before anyone has committed anything.
printf '*\n' > "$STATE_DIR/.gitignore"

# Everything below is also appended to the deploy log, so a failed unattended
# run can be read after the fact rather than reconstructed
if (( ! DRY_RUN )); then
  exec > >(tee -a "$DEPLOY_LOG") 2>&1
fi

printf '\n%s%s deploy%s  %s  branch=%s port=%s\n' \
  "$BOLD" "$APP_NAME" "$RESET" "$(date '+%Y-%m-%d %H:%M:%S')" "$BRANCH" "$PORT"

# Two deploys at once would race on .next and on the database.
#
# mkdir is the lock rather than flock, which macOS does not ship. Creating a
# directory is atomic on every POSIX filesystem, so the race is decided by the
# kernel rather than by a check-then-write in shell.
if (( ! DRY_RUN )); then
  if ! mkdir "$LOCK_FILE" 2>/dev/null; then
    LOCK_PID="$(cat "$LOCK_FILE/pid" 2>/dev/null || true)"
    if [[ -n "${LOCK_PID:-}" ]] && kill -0 "$LOCK_PID" 2>/dev/null; then
      die "Another deploy is already running (pid $LOCK_PID)"
    fi
    # The holder is gone - a previous run was killed mid-deploy
    warn "Clearing a stale lock left by pid ${LOCK_PID:-unknown}"
    rm -rf "$LOCK_FILE"
    mkdir "$LOCK_FILE" || die "Could not take the deploy lock"
  fi
  echo $$ > "$LOCK_FILE/pid"
  # Released however the script ends, including on failure or Ctrl-C
  trap 'rm -rf "$LOCK_FILE"' EXIT
fi

trap 'die "Deploy failed on line $LINENO. The running app was not stopped."' ERR

# ------------------------------------------------------------- preflight

step "Checking the working copy"

command -v git  >/dev/null || die "git is not installed"
command -v node >/dev/null || die "node is not installed"
command -v npm  >/dev/null || die "npm is not installed"

[[ -f "$REPO_ROOT/package.json" ]] || die "No package.json in $REPO_ROOT"
[[ -f "$REPO_ROOT/.env" ]] || warn ".env not found - DATABASE_URL may be unset"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  die "$REPO_ROOT is not a git repository"
fi

# A remote is what "pull from main" needs. Without one this is a local repo,
# and saying so plainly beats a git error about an unknown ref.
HAS_REMOTE=1
if ! git remote get-url origin >/dev/null 2>&1; then
  HAS_REMOTE=0
  warn "No 'origin' remote is configured - nothing to pull from."
  warn "Add one with:  git remote add origin <url>"
  warn "Continuing with the code already on disk."
fi

# Uncommitted work would be silently buried by a pull, so it stops the deploy
# unless --force is given, which stashes it somewhere recoverable instead.
if [[ -n "$(git status --porcelain)" ]]; then
  if (( FORCE )); then
    STASH_MSG="deploy.sh autostash $(date '+%Y-%m-%d %H:%M:%S')"
    warn "Working tree is dirty - stashing as: $STASH_MSG"
    run git stash push --include-untracked --message "$STASH_MSG"
    info "Recover it later with: git stash list && git stash pop"
  else
    printf '\n'
    git status --short | head -20
    die "Working tree has uncommitted changes. Commit them, or re-run with --force to stash."
  fi
fi

# ------------------------------------------------------------------ pull

BEFORE="$(git rev-parse HEAD)"

if (( HAS_REMOTE )); then
  step "Pulling $BRANCH"
  run git fetch --prune origin "$BRANCH"

  if ! git rev-parse --verify "origin/$BRANCH" >/dev/null 2>&1; then
    die "origin/$BRANCH does not exist. Check the branch name."
  fi

  CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  if [[ "$CURRENT_BRANCH" != "$BRANCH" ]]; then
    info "Switching from $CURRENT_BRANCH to $BRANCH"
    run git checkout "$BRANCH"
  fi

  # Fast-forward only: a deploy should never invent a merge commit on the
  # server. If the branches have diverged, a person needs to look at it.
  if ! run git merge --ff-only "origin/$BRANCH"; then
    die "Cannot fast-forward to origin/$BRANCH - the local branch has diverged."
  fi
else
  step "Skipping pull (no remote)"
fi

AFTER="$(git rev-parse HEAD)"

if [[ "$BEFORE" == "$AFTER" ]]; then
  if (( FORCE )); then
    info "Already up to date, but --force was given - continuing."
  else
    ok "Already up to date at ${AFTER:0:8} - nothing to deploy."
    info "Re-run with --force to rebuild and restart anyway."
    exit 0
  fi
else
  ok "Updated ${BEFORE:0:8} -> ${AFTER:0:8}"
  git --no-pager log --oneline "$BEFORE..$AFTER" | head -10 | sed 's/^/     /'
fi

# --------------------------------------------------------- dependencies

step "Installing dependencies"

# npm ci is reproducible but wipes node_modules, so it is only worth it when
# the lockfile actually moved. Otherwise install is enough and much faster.
if [[ "$BEFORE" != "$AFTER" ]] && ! git diff --quiet "$BEFORE" "$AFTER" -- package-lock.json package.json; then
  info "Lockfile changed - running a clean install"
  run npm ci
elif [[ ! -d node_modules ]]; then
  info "node_modules is missing - installing"
  run npm ci
else
  info "Dependencies unchanged - skipping"
fi

# ------------------------------------------------------------ migrations

step "Applying database migrations"

MIGRATIONS_DIR="$REPO_ROOT/prisma/migrations"

# "No migrations" is a normal state, not a failure: a release can contain no
# schema change at all, and a fresh checkout may not have the folder yet.
if [[ ! -d "$MIGRATIONS_DIR" ]] || [[ -z "$(find "$MIGRATIONS_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)" ]]; then
  warn "No migrations found - skipping. Schema is assumed to be current."
else
  PENDING_BEFORE="$(find "$MIGRATIONS_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
  info "$PENDING_BEFORE migration(s) in the repo"

  # migrate deploy is the non-interactive one: it applies what is outstanding
  # and exits cleanly when there is nothing to do. migrate dev would prompt,
  # and would offer to reset the database - never run that from a script.
  if ! run npx prisma migrate deploy; then
    die "Migration failed. The database is unchanged from this step onward and
    the running app was not stopped. Check 'npx prisma migrate status'."
  fi
  ok "Database schema is up to date"
fi

step "Generating the Prisma client"
# Always regenerated: the client is derived from schema.prisma, and a stale one
# fails at runtime with confusing 'Unknown argument' errors rather than at build
run npx prisma generate

if (( DO_SEED )); then
  step "Seeding the database"
  warn "The seed clears operational tables. This was asked for explicitly."
  run npm run db:seed
fi

# ----------------------------------------------------------------- build

if (( DO_BUILD )); then
  step "Building"
  # Deliberately before any restart: if this fails, the old server is still
  # serving the old build and the plant never notices.
  if ! run npm run build; then
    die "Build failed. The running app was left alone and is still serving the previous build."
  fi
  ok "Build succeeded"
else
  step "Skipping build (--skip-build)"
fi

# --------------------------------------------------------------- restart

app_is_up() {
  curl -fsS -o /dev/null --max-time 3 "http://127.0.0.1:${PORT}/" 2>/dev/null
}

wait_for_app() {
  local waited=0
  while (( waited < HEALTH_TIMEOUT )); do
    if app_is_up; then return 0; fi
    sleep 2
    waited=$(( waited + 2 ))
    if (( waited % 10 == 0 )); then
      info "Waiting for the app to answer on :${PORT} (${waited}s)"
    fi
  done
  return 1
}

if (( ! DO_RESTART )); then
  step "Skipping restart (--no-restart)"
  ok "Deploy finished at ${AFTER:0:8}. Restart when you are ready."
  exit 0
fi

step "Restarting the app"

if command -v pm2 >/dev/null 2>&1 && pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  # pm2 already supervises it - let pm2 do the restart so it keeps its own
  # log handling and startup-on-boot config
  info "Restarting under pm2"
  run pm2 restart "$APP_NAME" --update-env
else
  # Plain background process, tracked with a pid file
  if [[ -f "$PID_FILE" ]]; then
    OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "${OLD_PID:-}" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
      info "Stopping the previous app (pid $OLD_PID)"
      run kill "$OLD_PID" 2>/dev/null || true
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        kill -0 "$OLD_PID" 2>/dev/null || break
        sleep 1
      done
      # It had its chance to exit cleanly
      kill -0 "$OLD_PID" 2>/dev/null && run kill -9 "$OLD_PID" 2>/dev/null || true
    fi
    run rm -f "$PID_FILE"
  fi

  # Anything else squatting on the port would make the health check pass
  # against the wrong process, which is worse than failing
  if command -v lsof >/dev/null 2>&1; then
    SQUATTER="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
    if [[ -n "${SQUATTER:-}" ]]; then
      warn "Port $PORT is held by pid $SQUATTER - stopping it"
      run kill "$SQUATTER" 2>/dev/null || true
      sleep 2
    fi
  fi

  info "Starting: npm start -- -p $PORT"
  if (( ! DRY_RUN )); then
    : > "$APP_LOG"
    nohup npm start -- -p "$PORT" >> "$APP_LOG" 2>&1 &
    echo $! > "$PID_FILE"
    info "Started as pid $(cat "$PID_FILE")"
  fi
fi

if (( DRY_RUN )); then
  printf '\n%s✓ Dry run complete - nothing was changed.%s\n' "$GREEN" "$RESET"
  exit 0
fi

step "Health check"
if wait_for_app; then
  ok "App is answering on http://localhost:${PORT}"
else
  printf '\n%s--- last 30 lines of %s ---%s\n' "$DIM" "${APP_LOG#"$REPO_ROOT"/}" "$RESET"
  tail -30 "$APP_LOG" 2>/dev/null || true
  die "App did not come up within ${HEALTH_TIMEOUT}s. It is deployed at ${AFTER:0:8} but not serving."
fi

printf '\n%s%s✓ Deployed %s at %s%s\n\n' "$BOLD" "$GREEN" "${AFTER:0:8}" "http://localhost:${PORT}" "$RESET"

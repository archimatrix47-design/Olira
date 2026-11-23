#!/bin/sh
# Deploy one checkout of the repository to its Node app. Called by .cpanel.yml
# ("Deploy HEAD Commit" in cPanel > Git Version Control) from the checkout:
#
#   checkout on branch   Node app (Setup Node.js App)   data folder
#   main                 ~/olira                         ~/olira-data, ~/olira-uploads
#   staging              ~/olira-staging                 ~/olira-staging-data, ~/olira-staging-uploads
#
# The branch decides where it goes, so deploying the staging checkout can never
# land on the live site; any other branch stops without touching anything.
#
#   sh scripts/deploy.sh [checkout]      checkout defaults to the current folder
#   DEPLOY_DRY=1 sh scripts/deploy.sh    prints the plan, changes nothing
#
# NODEVER must match the version chosen for the app in Setup Node.js App.
set -eu

REPO="$(cd "${1:-.}" && pwd)"
HOME_DIR="${DEPLOY_HOME:-$HOME}"
NODEVER="${NODEVER:-20}"

[ -f "$REPO/server.js" ] && [ -f "$REPO/package.json" ] || { echo "deploy: $REPO is not the Olira checkout; nothing deployed." >&2; exit 1; }
BRANCH="$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

case "$BRANCH" in
  main)    APP_NAME=olira;         DATA_NAME=olira-data;         SITE_ENV=production ;;
  staging) APP_NAME=olira-staging; DATA_NAME=olira-staging-data; SITE_ENV=staging ;;
  *) echo "deploy: branch '$BRANCH' is neither main nor staging; nothing deployed." >&2; exit 1 ;;
esac
APP="$HOME_DIR/$APP_NAME"
DATA="$HOME_DIR/$DATA_NAME"
ACTIVATE="$HOME_DIR/nodevenv/$APP_NAME/$NODEVER/bin/activate"

echo "deploy: $BRANCH from $REPO"
echo "deploy:   app      $APP"
echo "deploy:   data     $DATA"
echo "deploy:   node     $ACTIVATE"
echo "deploy:   mode     $SITE_ENV$([ "$SITE_ENV" = production ] && echo ', then IndexNow' || true)"

# CloudLinux's activate script reads variables that are not set, so it is
# sourced with -u off (the first live deploy stopped here: CL_VIRTUAL_ENV).
use_node() { set +u; . "$ACTIVATE"; set -u; }

# cPanel runs deploy tasks with a cap on address space. WebAssembly (Astro's
# compiler) normally reserves a 10 GB block up front and then fails with
# "Cannot allocate Wasm memory" (the second live deploy stopped here). This
# Node option, made for capped processes, checks bounds in code instead.
wasm_fit() {
  ulimit -v "$(ulimit -H -v)" 2>/dev/null || true # up to the hard limit, where the host allows it
  if node --disable-wasm-trap-handler -e 0 2>/dev/null; then
    NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--disable-wasm-trap-handler"; export NODE_OPTIONS
    echo "deploy:   wasm     --disable-wasm-trap-handler (address space: $(ulimit -v))"
  else
    echo "deploy:   wasm     default (address space: $(ulimit -v))"
  fi
}

if [ -n "${DEPLOY_DRY:-}" ]; then
  if [ -f "$ACTIVATE" ]; then use_node; echo "deploy:   node -v  $(node -v)"; wasm_fit; else echo "deploy:   (no Node app there yet)"; fi
  echo "deploy: dry run, nothing changed."
  exit 0
fi

[ -f "$ACTIVATE" ] || { echo "deploy: no Node $NODEVER app at $APP. Create it in Setup Node.js App first." >&2; exit 1; }
use_node
wasm_fit

# Copy the code in. Kept: .git (none here), node_modules (a link into nodevenv),
# tmp (the restart trigger), dist (rebuilt below), and .env if one exists.
/usr/bin/rsync -a --delete --exclude='.git' --exclude='node_modules' --exclude='tmp' --exclude='dist' --exclude='.env' "$REPO/" "$APP/"

cd "$APP"
# CloudLinux runs npm inside the app's nodevenv folder, which keeps its OWN lock file
# and only links package.json: without this copy the repo's locked, audited versions
# were never used, and an existing app kept old ones (live ran multer 2.2.0,
# body-parser 1.20.6, nodemailer 10.1.0 and qs 6.15.3, all with advisories, until
# 23 Nov 2026).
VENV_LIB="$HOME_DIR/nodevenv/$APP_NAME/$NODEVER/lib"
# After the first such install the host links its lock file to the app's (seen 23 Nov
# 2026), so a second copy would fail as "the same file": then there is nothing to copy.
if [ -d "$VENV_LIB" ] && [ -f "$APP/package-lock.json" ]; then
  if [ "$APP/package-lock.json" -ef "$VENV_LIB/package-lock.json" ]; then
    echo "deploy:   lock     the repo's package-lock.json (already linked)"
  else
    cp "$APP/package-lock.json" "$VENV_LIB/package-lock.json"
    echo "deploy:   lock     the repo's package-lock.json"
  fi
fi
npm install
# the versions that will run, in the log, so a deploy shows what it installed
# (read from node_modules directly: sharp, for one, does not let require() load its package.json)
node -e "const fs = require('fs'); for (const n of ['express', 'multer', 'body-parser', 'qs', 'nodemailer', 'sharp']) { try { console.log('deploy:   ' + n + ' ' + JSON.parse(fs.readFileSync('node_modules/' + n + '/package.json', 'utf8')).version); } catch (e) { console.log('deploy:   ' + n + ' missing'); } }"
# the pages are built from this app's own data (src/lib/site-data.ts)
DATA_DIR="$DATA" SITE_ENV="$SITE_ENV" npm run build
/bin/sh "$APP/scripts/restart-app.sh" "$APP"

# search engines hear about the live site only
if [ "$SITE_ENV" = production ]; then node scripts/indexnow.mjs || true; fi
echo "deploy: done."

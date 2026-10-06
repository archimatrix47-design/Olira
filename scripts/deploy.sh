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
[ -n "${DEPLOY_DRY:-}" ] && { echo "deploy: dry run, nothing changed."; exit 0; }

[ -f "$ACTIVATE" ] || { echo "deploy: no Node $NODEVER app at $APP. Create it in Setup Node.js App first." >&2; exit 1; }

# Copy the code in. Kept: .git (none here), node_modules (a link into nodevenv),
# tmp (the restart trigger), dist (rebuilt below), and .env if one exists.
/usr/bin/rsync -a --delete --exclude='.git' --exclude='node_modules' --exclude='tmp' --exclude='dist' --exclude='.env' "$REPO/" "$APP/"

# shellcheck disable=SC1090
. "$ACTIVATE"
cd "$APP"
npm install
# the pages are built from this app's own data (src/lib/site-data.ts)
DATA_DIR="$DATA" SITE_ENV="$SITE_ENV" npm run build
/bin/sh "$APP/scripts/restart-app.sh" "$APP"

# search engines hear about the live site only
if [ "$SITE_ENV" = production ]; then node scripts/indexnow.mjs || true; fi
echo "deploy: done."

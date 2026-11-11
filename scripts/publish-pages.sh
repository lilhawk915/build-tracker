#!/bin/sh
# Builds and publishes to GitHub Pages. Keeps the previous build's script files so pages
# already open on someone's phone or computer keep working after an update.
set -e
cd "$(dirname "$0")/.."
REPO=https://github.com/lilhawk915/build-tracker.git
npm run build:pages >/dev/null
OLD=$(mktemp -d)
git clone -q --depth 1 --branch gh-pages "$REPO" "$OLD" 2>/dev/null || true
[ -d "$OLD/assets" ] && cp -n "$OLD"/assets/* dist/assets/ 2>/dev/null || true
cd dist
git init -q -b gh-pages && git add -A && git commit -qm "Publish" && git push -q -f "$REPO" gh-pages
rm -rf .git "$OLD"
echo published

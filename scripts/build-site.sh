#!/usr/bin/env sh
# Copies site/ to dist/site/ and injects APPS_SCRIPT_URL (from the environment, else from .env).
set -eu
cd "$(dirname "$0")/.."

if [ -z "${APPS_SCRIPT_URL:-}" ] && [ -f .env ]; then
  set -a; . ./.env; set +a
fi
: "${APPS_SCRIPT_URL:?APPS_SCRIPT_URL is not set (export it or put it in .env)}"

rm -rf dist/site && mkdir -p dist
cp -R site dist/site
sed "s|__APPS_SCRIPT_URL__|${APPS_SCRIPT_URL}|g" site/index.html > dist/site/index.html

if grep -q '__APPS_SCRIPT_URL__' dist/site/index.html; then
  echo "build: placeholder was not replaced" >&2
  exit 1
fi
echo "build: dist/site/ ready"

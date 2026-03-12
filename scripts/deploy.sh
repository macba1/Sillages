#!/usr/bin/env bash
set -e

echo "Running premerge check..."
cd "$(dirname "$0")/../backend"
npm run premerge
cd ..

echo ""
echo "Type check passed. Merging develop → main..."
git checkout main
git merge develop
git push origin main
git checkout develop

echo ""
echo "Done. Main updated and pushed. Railway will deploy automatically."

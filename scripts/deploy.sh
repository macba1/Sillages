#!/usr/bin/env bash
set -e

# Migrations are NOT applied here. Deploying and migrating are separate,
# deliberate acts: see docs/migrations.md and ./scripts/migrate.sh. Run
# `./scripts/migrate.sh plan production` before this, and apply what it lists.
echo "Reminder: have you applied pending migrations? ./scripts/migrate.sh plan production"

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

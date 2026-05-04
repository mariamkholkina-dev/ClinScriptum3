#!/usr/bin/env bash
# Deploy / update ClinScriptum on the dev server.
# Usage: cd /opt/clinscriptum && ./deploy.sh [--no-pull] [--no-migrate]
set -euo pipefail

cd "$(dirname "$0")/.."

PULL=1
MIGRATE=1
for arg in "$@"; do
  case "$arg" in
    --no-pull)    PULL=0 ;;
    --no-migrate) MIGRATE=0 ;;
    *) echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

COMPOSE="docker compose -f docker-compose.prod.yml"

if [[ $PULL -eq 1 ]]; then
  echo "==> git pull"
  git pull --ff-only
fi

echo "==> Bringing up infra (postgres, redis, minio)"
$COMPOSE up -d postgres redis minio

if [[ $MIGRATE -eq 1 ]]; then
  echo "==> Running prisma migrate deploy"
  $COMPOSE --profile migrate run --rm migrate
fi

echo "==> Building app images (sequential to fit 8 GB RAM)"
$COMPOSE build api
$COMPOSE build workers
$COMPOSE build web
$COMPOSE build rule-admin

echo "==> Starting application services"
$COMPOSE up -d api workers web rule-admin

echo "==> Pruning old images"
docker image prune -f

echo "==> Status"
$COMPOSE ps

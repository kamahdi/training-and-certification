#!/usr/bin/env bash
# Runs the Clinic Waiting Room on this machine with Docker (ADR-006: the app container + Postgres).
# Safe to run again: it keeps the existing secrets and database, rebuilds the app and reloads today's demo.
#
#   bash scripts/run-local.sh            (from the app folder, or give its path from anywhere)
#   SKIP_BUILD=1 bash scripts/run-local.sh   reuse the image already built
#   APP_PORT=3001 bash scripts/run-local.sh  use another port than 3000
set -euo pipefail

cd "$(dirname "$0")/.."
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

say "1/5 Checking Docker"
command -v docker >/dev/null || fail "Docker is not installed. On Windows: install Docker Desktop and turn on Settings > Resources > WSL integration for Ubuntu. Or in Ubuntu: sudo apt install docker.io docker-compose-v2"
docker compose version >/dev/null 2>&1 || fail "Docker Compose is missing. In Ubuntu: sudo apt install docker-compose-v2"
if ! docker info >/dev/null 2>&1; then
  if docker info 2>&1 | grep -q "permission denied"; then
    fail "No permission to use Docker. Run: sudo usermod -aG docker \$USER   then close and reopen the terminal, and run this script again."
  fi
  fail "Docker is not running. Start Docker Desktop on Windows, or in Ubuntu run: sudo service docker start"
fi
echo "ok: $(docker --version)"

say "2/5 Secrets"
if [ -f .env ] && grep -q '^FIELD_ENCRYPTION_KEY=.\+' .env && grep -q '^LINK_SECRET=.\+' .env; then
  echo "ok: keeping the secrets in app/.env"
else
  command -v openssl >/dev/null || fail "openssl is missing. Run: sudo apt install openssl"
  touch .env
  sed -i '/^FIELD_ENCRYPTION_KEY=/d;/^LINK_SECRET=/d' .env
  printf 'FIELD_ENCRYPTION_KEY=%s\nLINK_SECRET=%s\n' "$(openssl rand -base64 32)" "$(openssl rand -hex 32)" >> .env
  echo "ok: new secrets written to app/.env (keep this file; it decrypts the stored form answers)"
fi
if [ -n "${APP_PORT:-}" ]; then
  sed -i '/^APP_PORT=/d' .env
  echo "APP_PORT=$APP_PORT" >> .env
fi
PORT=$(grep '^APP_PORT=' .env | cut -d= -f2 || true)
PORT=${PORT:-3000}

say "3/5 Building and starting (the first build takes a few minutes)"
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  docker compose up -d --no-build --wait
else
  docker compose up -d --build --wait
fi

say "4/5 Loading the demo staff and today's demo appointments"
docker compose exec -T app node dist/server/server/seed.js --demo

say "5/5 Checking it answers"
for _ in $(seq 1 30); do
  if curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    printf '\n\033[32mThe app is running.\033[0m\n'
    echo "  Staff sign-in:  http://localhost:$PORT/staff"
    echo "  Accounts:       reception@demo.clinic, peeters@demo.clinic, janssens@demo.clinic, manager@demo.clinic"
    echo "  Password:       demo-password"
    echo "  Patient texts:  http://localhost:$PORT/api/dev/outbox  (after signing in as reception, same browser)"
    echo "  Stop:           docker compose down      (add -v to delete the database)"
    exit 0
  fi
  sleep 1
done
fail "The app did not answer on port $PORT. Its log: docker compose logs app"

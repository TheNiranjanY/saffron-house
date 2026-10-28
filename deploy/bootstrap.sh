#!/usr/bin/env bash
# One-shot bootstrap for a fresh Ubuntu VM (Oracle Cloud Always Free).
# Installs Docker, opens ports 80/443, clones the repo, builds the stack,
# loads both schemas, seeds the canonical dataset and starts the site.
#
#   curl -fsSL https://raw.githubusercontent.com/TheNiranjanY/saffron-house/main/deploy/bootstrap.sh \
#     | sudo bash
#
# Re-running is safe: schemas and seed are loaded once (marker deploy/.seeded).
set -euo pipefail

REPO="${REPO:-https://github.com/TheNiranjanY/saffron-house.git}"
DIR="${DIR:-/opt/saffron-house}"
COMPOSE_FILE="deploy/docker-compose.prod.yml"

log() { printf '\n== %s\n' "$*"; }

if ! grep -qi ubuntu /etc/os-release; then
  echo "This script targets Ubuntu; found $(grep ^PRETTY_NAME /etc/os-release)." >&2
  exit 1
fi

log "Base packages"
APT_PACKAGES=()
for bin in git curl openssl; do
  command -v "$bin" >/dev/null 2>&1 || APT_PACKAGES+=("$bin")
done
[ -e /etc/ssl/certs/ca-certificates.crt ] || APT_PACKAGES+=("ca-certificates")
if [ ${#APT_PACKAGES[@]} -gt 0 ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y "${APT_PACKAGES[@]}"
fi

log "Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

log "Firewall (Oracle images block 80/443 by default)"
for port in 80 443; do
  iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
    || iptables -I INPUT -p tcp --dport "$port" -j ACCEPT
done
if command -v netfilter-persistent >/dev/null 2>&1; then
  netfilter-persistent save
else
  DEBIAN_FRONTEND=noninteractive apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent
  netfilter-persistent save
fi

log "Repository"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --depth=1 origin main
  git -C "$DIR" reset --hard origin/main
else
  git clone --depth=1 "$REPO" "$DIR"
fi
cd "$DIR"

log "Environment"
if [ ! -f deploy/.env ]; then
  cat > deploy/.env <<EOF
MYSQL_ROOT_PASSWORD=$(openssl rand -hex 16)
MYSQL_DATABASE=restaurant
MYSQL_USER=restaurant
MYSQL_PASSWORD=$(openssl rand -hex 16)
MYSQL_HOST=mysql
MYSQL_PORT=3306
MYSQL_POOL_SIZE=4
TS_DATABASE=restaurant_analytics
TS_USER=restaurant
TS_PASSWORD=$(openssl rand -hex 16)
TS_HOST=timescale
TS_PORT=5432
TS_POOL_MAX=3
TZ=Asia/Kolkata
FLASK_DEBUG=0
SQL_LAB_ENABLED=1
SITE_ADDRESS=
EOF
  chmod 600 deploy/.env
  echo "Generated deploy/.env with random database passwords."
fi

compose() { docker compose -f "$COMPOSE_FILE" --env-file deploy/.env "$@"; }

wait_healthy() {
  local service=$1 id status
  for _ in $(seq 1 90); do
    id=$(compose ps -q "$service" 2>/dev/null || true)
    if [ -n "$id" ]; then
      status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id")
      [ "$status" = "healthy" ] && return 0
    fi
    sleep 2
  done
  echo "Timed out waiting for $service" >&2
  compose logs --tail=60 "$service" >&2
  return 1
}

log "Starting databases"
compose up -d mysql timescale
wait_healthy mysql
wait_healthy timescale

if [ ! -f deploy/.seeded ]; then
  log "Loading MySQL schema"
  compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
    < database/mysql/01_schema.sql

  log "Loading TimescaleDB schema"
  compose exec -T timescale sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' \
    < database/timescale/01_schema.sql

  log "Seeding the canonical dataset (1-2 minutes)"
  compose build api
  compose run --rm api python backend/scripts/seed.py
  touch deploy/.seeded
else
  log "Schemas and seed already present (deploy/.seeded)"
fi

log "Starting the site"
compose up -d --build

log "Status"
compose ps
IP=$(curl -fsS --max-time 5 https://api.ipify.org || echo "<vm-ip>")
echo
echo "Saffron House: http://$IP"
echo "Health:        http://$IP/api/health"
echo
echo "Enable HTTPS later: set SITE_ADDRESS=<name>.sslip.io (or your domain) in"
echo "$DIR/deploy/.env, then: cd $DIR && docker compose -f $COMPOSE_FILE --env-file deploy/.env up -d"

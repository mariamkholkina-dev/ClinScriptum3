#!/usr/bin/env bash
# deploy/bootstrap-dev-server.sh
#
# Provision a fresh Ubuntu 22.04+ server (141.105.71.244) for ClinScriptum dev.
# Idempotent — safe to re-run. Designed to be run as root over SSH.
#
# Workflow:
#   1. On laptop:   .\deploy\upload-local-data.ps1     (dumps DB + uploads, scps to server)
#   2. On server:   ssh root@141.105.71.244
#                   curl -fsSL <raw-url>/bootstrap.sh -o /root/bootstrap.sh
#                   LE_EMAIL=ops@example.com bash /root/bootstrap.sh
#
# Or scp the script:
#   scp deploy/bootstrap-dev-server.sh root@141.105.71.244:/root/bootstrap.sh
#
# Private repo? Either:
#   - REPO_URL=https://<user>:<token>@github.com/mariamkholkina-dev/ClinScriptum3.git
#   - Set up an SSH deploy key on the server first, then use git@ URL.
#
# Inputs (env vars; prompted interactively if missing):
#   REPO_URL          — defaults to the project HTTPS URL
#   LE_EMAIL          — required, for Let's Encrypt notifications
#   BASIC_AUTH_USER   — defaults to "devuser"
#   BASIC_AUTH_PASS   — generated if not provided
#
# DB / file restore (auto-detected, optional):
#   /root/clinscriptum.dump        — Postgres custom-format dump
#   /root/uploads.tar.gz           — local uploads (STORAGE_TYPE=local)
#   /root/minio-backup.tar.gz      — MinIO bucket export (STORAGE_TYPE=s3)

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────
REPO_URL="${REPO_URL:-https://github.com/mariamkholkina-dev/ClinScriptum3.git}"
REPO_BRANCH="${REPO_BRANCH:-master}"
LE_EMAIL="${LE_EMAIL:-}"
BASIC_AUTH_USER="${BASIC_AUTH_USER:-devuser}"
BASIC_AUTH_PASS="${BASIC_AUTH_PASS:-}"
DEPLOY_DIR="/opt/clinscriptum"
SERVER_IP="141.105.71.244"
PG_DUMP_PATH="${PG_DUMP_PATH:-/root/clinscriptum.dump}"
UPLOADS_TGZ_PATH="${UPLOADS_TGZ_PATH:-/root/uploads.tar.gz}"
MINIO_TGZ_PATH="${MINIO_TGZ_PATH:-/root/minio-backup.tar.gz}"
DOMAINS=(
  "app.dev.clinscriptum.ru"
  "admin.dev.clinscriptum.ru"
  "api.dev.clinscriptum.ru"
)

# ─── Helpers ──────────────────────────────────────────────────────────────
log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m  %s\n' "$*" >&2; }
die()  { printf '\033[1;31mxx\033[0m  %s\n' "$*" >&2; exit 1; }

prompt() {
  local var="$1" message="$2" silent="${3:-0}"
  if [[ -n "${!var}" ]]; then return; fi
  if [[ ! -t 0 ]]; then die "$var not set and no TTY for prompt"; fi
  if [[ "$silent" == "1" ]]; then
    read -rsp "$message: " "$var"; echo
  else
    read -rp "$message: " "$var"
  fi
}

# ─── Phase 1: preflight ───────────────────────────────────────────────────
preflight() {
  [[ $EUID -eq 0 ]] || die "Run as root: sudo bash $0"
  command -v apt-get >/dev/null || die "apt-get not found — Ubuntu/Debian only"
  . /etc/os-release
  [[ "${ID:-}" == "ubuntu" ]] || warn "Detected ${ID:-?}, expected ubuntu — proceeding"
  log "Ubuntu ${VERSION_ID:-?} detected"
}

prompt_inputs() {
  prompt REPO_URL "Git repo URL (https or ssh)"
  prompt LE_EMAIL "Email for Let's Encrypt notifications"
  if [[ -z "$BASIC_AUTH_PASS" ]]; then
    BASIC_AUTH_PASS=$(openssl rand -base64 24 | tr -d '/+=')
    log "Generated basic-auth password for '$BASIC_AUTH_USER':"
    log "    $BASIC_AUTH_PASS"
    log "Save it now — it won't be shown again."
    if [[ -t 0 ]]; then read -rp "Press Enter to continue..." _; fi
  fi
}

# ─── Phase 2: system packages ─────────────────────────────────────────────
apt_install() {
  log "apt update / upgrade"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get -o Dpkg::Options::="--force-confdef" \
          -o Dpkg::Options::="--force-confold" \
          upgrade -y -qq
  apt-get install -y -qq \
    ca-certificates curl git jq nano \
    ufw fail2ban dnsutils \
    nginx apache2-utils \
    openssl
}

# ─── Phase 3: swap, firewall ──────────────────────────────────────────────
setup_swap() {
  if swapon --show | grep -q '/swapfile'; then
    log "Swap already active, skipping"
    return
  fi
  log "Creating 8 GB swap"
  fallocate -l 8G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab \
    || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null
  grep -q '^vm.swappiness' /etc/sysctl.conf \
    || echo 'vm.swappiness=10' >> /etc/sysctl.conf
}

setup_firewall() {
  log "Configuring ufw (allow 22, 80, 443)"
  ufw allow 22/tcp  >/dev/null
  ufw allow 80/tcp  >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
  systemctl enable --now fail2ban >/dev/null
}

# ─── Phase 4: docker ──────────────────────────────────────────────────────
install_docker() {
  if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
    log "Docker already installed"
    return
  fi
  log "Installing Docker Engine + Compose plugin"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --batch --yes --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq \
    docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin

  if [[ ! -f /etc/docker/daemon.json ]]; then
    log "Configuring docker log rotation"
    cat >/etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "5" }
}
EOF
    systemctl restart docker
  fi
  systemctl enable --now docker >/dev/null
}

# ─── Phase 5: certbot ─────────────────────────────────────────────────────
install_certbot() {
  if command -v certbot >/dev/null; then
    log "certbot already installed"
    return
  fi
  log "Installing certbot + nginx plugin"
  apt-get install -y -qq certbot python3-certbot-nginx
  mkdir -p /etc/letsencrypt/renewal-hooks/deploy
  cat >/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'EOF'
#!/bin/sh
systemctl reload nginx
EOF
  chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
}

# ─── Phase 6: clone repo ──────────────────────────────────────────────────
clone_repo() {
  mkdir -p "$DEPLOY_DIR"
  if [[ -d "$DEPLOY_DIR/.git" ]]; then
    log "Repo already at $DEPLOY_DIR — pulling $REPO_BRANCH"
    git -C "$DEPLOY_DIR" fetch --all --quiet
    git -C "$DEPLOY_DIR" checkout "$REPO_BRANCH"
    git -C "$DEPLOY_DIR" pull --ff-only --quiet
  else
    log "Cloning $REPO_URL → $DEPLOY_DIR"
    git clone --branch "$REPO_BRANCH" "$REPO_URL" "$DEPLOY_DIR" || die \
      "git clone failed. For a private repo:
       - HTTPS: embed a PAT in REPO_URL (https://<user>:<token>@github.com/...)
       - SSH:   set up the deploy key on the server first, then re-run."
  fi
  chmod +x "$DEPLOY_DIR/deploy/deploy.sh" 2>/dev/null || true
}

# ─── Phase 7: .env with generated secrets ─────────────────────────────────
generate_env() {
  local env_file="$DEPLOY_DIR/.env"
  if [[ -f "$env_file" ]]; then
    log ".env already exists at $env_file — not overwriting"
    return
  fi
  [[ -f "$DEPLOY_DIR/.env.production.example" ]] \
    || die "Missing $DEPLOY_DIR/.env.production.example — pull latest from repo"
  log "Generating .env with strong passwords"
  cp "$DEPLOY_DIR/.env.production.example" "$env_file"

  local pg_pass jwt_secret minio_pass
  pg_pass=$(openssl rand -hex 24)
  jwt_secret=$(openssl rand -hex 64)
  minio_pass=$(openssl rand -hex 24)

  sed -i \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$pg_pass|" \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://clinscriptum:$pg_pass@postgres:5432/clinscriptum|" \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=$jwt_secret|" \
    -e "s|^MINIO_ROOT_PASSWORD=.*|MINIO_ROOT_PASSWORD=$minio_pass|" \
    -e "s|^S3_SECRET_ACCESS_KEY=.*|S3_SECRET_ACCESS_KEY=$minio_pass|" \
    "$env_file"

  chmod 600 "$env_file"
  warn "LLM_API_KEY in $env_file is still a placeholder — fill it before deploy.sh"
}

# ─── Phase 8: nginx ACME staging config ───────────────────────────────────
install_nginx_acme_stage() {
  log "Installing temporary nginx config for ACME challenge"
  rm -f /etc/nginx/sites-enabled/default
  rm -f /etc/nginx/conf.d/clinscriptum-dev.conf
  mkdir -p /var/www/certbot
  chown -R www-data:www-data /var/www/certbot

  cat >/etc/nginx/conf.d/clinscriptum-dev-acme.conf <<'EOF'
server {
  listen 80 default_server;
  listen [::]:80 default_server;
  server_name _;
  location /.well-known/acme-challenge/ { root /var/www/certbot; }
  location / { return 404; }
}
EOF
  nginx -t >/dev/null
  systemctl reload nginx
}

# ─── Phase 9: DNS + cert issuance ─────────────────────────────────────────
check_dns() {
  log "Verifying DNS A-records"
  local failed=0
  for d in "${DOMAINS[@]}"; do
    local ip
    ip=$(dig +short +time=3 +tries=2 A "$d" | tail -n1)
    if [[ "$ip" == "$SERVER_IP" ]]; then
      log "  $d → $ip ✓"
    else
      warn "  $d → '${ip:-no answer}' (expected $SERVER_IP)"
      failed=1
    fi
  done
  if [[ $failed -eq 1 ]]; then
    warn "Fix DNS A-records before continuing — certbot will fail otherwise."
    if [[ -t 0 ]]; then
      read -rp "Continue anyway? [y/N] " ans
      [[ "${ans,,}" == "y" ]] || die "Aborted by user"
    else
      die "DNS check failed (non-interactive)"
    fi
  fi
}

issue_certs() {
  for d in "${DOMAINS[@]}"; do
    if [[ -d "/etc/letsencrypt/live/$d" ]]; then
      log "Cert for $d already exists, skipping"
      continue
    fi
    log "Issuing cert for $d"
    certbot certonly --webroot -w /var/www/certbot \
      --non-interactive --agree-tos \
      --email "$LE_EMAIL" \
      -d "$d" \
      || die "certbot failed for $d (DNS or port 80?)"
  done
}

# ─── Phase 10: final nginx config + basic auth ────────────────────────────
install_final_nginx() {
  log "Installing final nginx config"
  rm -f /etc/nginx/conf.d/clinscriptum-dev-acme.conf
  cp "$DEPLOY_DIR/deploy/nginx/clinscriptum-dev.conf" \
     /etc/nginx/conf.d/clinscriptum-dev.conf
  nginx -t >/dev/null
  systemctl reload nginx
}

setup_basic_auth() {
  if [[ -f /etc/nginx/.htpasswd-dev ]] \
     && grep -q "^$BASIC_AUTH_USER:" /etc/nginx/.htpasswd-dev; then
    log "Basic-auth user '$BASIC_AUTH_USER' already exists"
    return
  fi
  log "Creating basic-auth user '$BASIC_AUTH_USER'"
  htpasswd -cbB /etc/nginx/.htpasswd-dev "$BASIC_AUTH_USER" "$BASIC_AUTH_PASS"
  chown root:www-data /etc/nginx/.htpasswd-dev
  chmod 640 /etc/nginx/.htpasswd-dev
  systemctl reload nginx
}

# ─── Phase 11: bring up infra ─────────────────────────────────────────────
start_infra() {
  log "Starting Postgres / Redis / MinIO via docker compose"
  cd "$DEPLOY_DIR"
  docker compose -f docker-compose.prod.yml up -d postgres redis minio

  log "Waiting for Postgres to be healthy..."
  local i=0
  until docker compose -f docker-compose.prod.yml exec -T postgres \
        pg_isready -U clinscriptum >/dev/null 2>&1; do
    ((i++)) || true
    [[ $i -gt 30 ]] && die "Postgres did not become healthy in 60s"
    sleep 2
  done
  log "Postgres healthy"
}

# ─── Phase 11.5: restore Postgres dump (if present) ───────────────────────
restore_postgres() {
  if [[ ! -f "$PG_DUMP_PATH" ]]; then
    log "No Postgres dump at $PG_DUMP_PATH — skipping DB restore"
    return
  fi
  cd "$DEPLOY_DIR"

  # Skip if DB already has user tables (avoid clobbering on re-run)
  local table_count
  table_count=$(docker compose -f docker-compose.prod.yml exec -T postgres \
    psql -U clinscriptum -d clinscriptum -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" \
    2>/dev/null || echo 0)
  if [[ "${table_count:-0}" -gt 0 ]]; then
    log "Postgres already has $table_count tables — skipping restore (delete DB manually to re-run)"
    return
  fi

  log "Restoring Postgres dump from $PG_DUMP_PATH (this may take a few minutes)"
  docker compose -f docker-compose.prod.yml exec -T postgres \
    psql -U clinscriptum -d postgres \
    -c "DROP DATABASE IF EXISTS clinscriptum;" \
    -c "CREATE DATABASE clinscriptum OWNER clinscriptum;" >/dev/null

  local cid
  cid=$(docker compose -f docker-compose.prod.yml ps -q postgres)
  docker cp "$PG_DUMP_PATH" "$cid:/tmp/clinscriptum.dump"
  docker compose -f docker-compose.prod.yml exec -T postgres \
    pg_restore -U clinscriptum -d clinscriptum \
      --no-owner --no-acl -j 2 /tmp/clinscriptum.dump \
    || warn "pg_restore reported errors — check output above (often harmless: COMMENT/EXTENSION ownership)"

  docker compose -f docker-compose.prod.yml exec -T postgres \
    rm -f /tmp/clinscriptum.dump
  log "Postgres restore complete"
}

# ─── Phase 11.6: restore document files (if present) ──────────────────────
restore_files() {
  local archive=""
  local subdir=""
  if [[ -f "$MINIO_TGZ_PATH" ]]; then
    archive="$MINIO_TGZ_PATH"
    subdir=""              # tarball is the bucket contents at root
    log "Found MinIO bucket archive: $archive"
  elif [[ -f "$UPLOADS_TGZ_PATH" ]]; then
    archive="$UPLOADS_TGZ_PATH"
    subdir=""              # local-uploads tarball — pushed into bucket root too
    log "Found local uploads archive: $archive"
  else
    log "No file archive at $MINIO_TGZ_PATH or $UPLOADS_TGZ_PATH — skipping file restore"
    return
  fi

  cd "$DEPLOY_DIR"
  local minio_cid
  minio_cid=$(docker compose -f docker-compose.prod.yml ps -q minio)
  [[ -n "$minio_cid" ]] || die "MinIO container not running"

  # Read MinIO creds from .env
  local minio_user minio_pass bucket
  minio_user=$(grep -E '^MINIO_ROOT_USER=' "$DEPLOY_DIR/.env" | cut -d= -f2-)
  minio_pass=$(grep -E '^MINIO_ROOT_PASSWORD=' "$DEPLOY_DIR/.env" | cut -d= -f2-)
  bucket=$(grep -E '^S3_BUCKET=' "$DEPLOY_DIR/.env" | cut -d= -f2-)
  bucket="${bucket:-clinscriptum-dev}"

  log "Restoring files into MinIO bucket '$bucket'"
  docker cp "$archive" "$minio_cid:/tmp/restore.tar.gz"

  docker compose -f docker-compose.prod.yml exec -T \
    -e MINIO_USER="$minio_user" \
    -e MINIO_PASS="$minio_pass" \
    -e BUCKET="$bucket" \
    minio sh -c '
      set -e
      rm -rf /tmp/restore && mkdir -p /tmp/restore
      tar xzf /tmp/restore.tar.gz -C /tmp/restore
      # Pick the deepest single dir if archive wraps content (e.g. ./uploads/...)
      src=/tmp/restore
      if [ "$(ls -1 /tmp/restore | wc -l)" = "1" ] && [ -d "/tmp/restore/$(ls -1 /tmp/restore)" ]; then
        src="/tmp/restore/$(ls -1 /tmp/restore)"
      fi
      mc alias set local http://localhost:9000 "$MINIO_USER" "$MINIO_PASS" >/dev/null
      mc mb -p "local/$BUCKET" 2>/dev/null || true
      mc mirror --overwrite --quiet "$src/" "local/$BUCKET/"
      rm -rf /tmp/restore /tmp/restore.tar.gz
    ' \
    || warn "File restore reported errors — check above"

  log "File restore complete"
}

# ─── Phase 12: summary ────────────────────────────────────────────────────
print_next_steps() {
  cat <<EOF

╭─────────────────────────────────────────────────────────────────────╮
│  Bootstrap complete ✓                                                │
╰─────────────────────────────────────────────────────────────────────╯

Live (HTTPS, basic auth user: $BASIC_AUTH_USER):
  https://app.dev.clinscriptum.ru
  https://admin.dev.clinscriptum.ru
  https://api.dev.clinscriptum.ru   (no basic auth)

Infra running:
$(cd "$DEPLOY_DIR" && docker compose -f docker-compose.prod.yml ps --format '  - {{.Service}}: {{.Status}}')

═════════════════════════════════════════════════════════════════════
NEXT STEPS — run on the server:
═════════════════════════════════════════════════════════════════════

  1. Edit secrets (LLM key etc.):
       nano $DEPLOY_DIR/.env

  2. (If you skipped the local-data upload BEFORE bootstrap)
     From your laptop, run:
       .\deploy\upload-local-data.ps1
     Then re-run this bootstrap to pick up the dumps:
       bash /root/bootstrap.sh

  3. Build and start app services (≈ 10–15 min on this hardware):
       cd $DEPLOY_DIR
       ./deploy/deploy.sh --no-pull --no-migrate

  4. Smoke test in browser:
       https://app.dev.clinscriptum.ru
       (basic auth: $BASIC_AUTH_USER / <password shown above>)

═════════════════════════════════════════════════════════════════════
EOF
}

# ─── Main ─────────────────────────────────────────────────────────────────
main() {
  preflight
  prompt_inputs
  apt_install
  setup_swap
  setup_firewall
  install_docker
  install_certbot
  clone_repo
  generate_env
  install_nginx_acme_stage
  check_dns
  issue_certs
  install_final_nginx
  setup_basic_auth
  start_infra
  restore_postgres
  restore_files
  print_next_steps
}

main "$@"

# Deploying Business OS

One Linux server running Docker Compose: Caddy (HTTPS) → web → API → Postgres and Redis. Good for staging and for early production; nothing but Caddy is reachable from the internet.

```
Internet ─443─▶ caddy ──▶ web:3000 ──/api──▶ api:4000 ──▶ db (Postgres 16), redis
                (certificates)                         └──▶ mailpit (catches email when SMTP_URL is empty)
```

## 1. Server (once)

- Ubuntu 24.04, 2 vCPU / 4 GB RAM is plenty for testing (e.g. Hetzner CX22, DigitalOcean, Lightsail in Mumbai). Building the images needs about 3 GB of RAM: with 2 GB, add swap.
- DNS: an **A record** for your domain (e.g. `staging.example.in`) pointing at the server's IP. Caddy can only get a certificate once this resolves.
- Firewall: allow 22, 80 and 443 only.

```bash
# as root
curl -fsSL https://get.docker.com | sh
adduser --disabled-password deploy && usermod -aG docker deploy
mkdir -p /opt/bos /var/backups/bos && chown deploy: /opt/bos /var/backups/bos
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw allow 443/udp && ufw --force enable
```

## 2. First deploy

```bash
# as deploy
git clone https://github.com/amaldeeps7/bos.git /opt/bos && cd /opt/bos   # private repo: use a read-only deploy key
git checkout staging            # or main
cp deploy/.env.production.example .env && chmod 600 .env
for v in POSTGRES_PASSWORD APP_DB_PASSWORD JWT_SECRET MFA_KEY; do sed -i "s/^$v=.*/$v=$(openssl rand -hex 32)/" .env; done
nano .env                       # DOMAIN, ACME_EMAIL, EMAIL_FROM, and SMTP_URL / ANTHROPIC_API_KEY if you have them

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f api caddy
```

Open `https://DOMAIN`. With `SEED_DEMO=true`, sign in as `priya@democonsulting.in` / `demo1234`, or create an organisation.

Make an alias so the commands below are short: `echo "alias dc='docker compose -f docker-compose.yml -f docker-compose.prod.yml'" >> ~/.bashrc`.

**Keep `.env` safe.** `MFA_KEY` encrypts two-factor secrets and organisations' AI keys: lose it and everyone has to set two-factor up again and Owners must re-enter their AI keys. Keep a copy in a password manager.

## 3. Updating

By hand:

```bash
cd /opt/bos && git pull && dc up -d --build
```

The API runs database migrations each time it starts. The site is briefly unavailable (a few seconds) while containers restart.

Automatically, on every push to the `staging` branch: `.github/workflows/deploy-staging.yml` type-checks, then SSHes in and runs the same commands, and fails if the API isn't healthy within 5 minutes. In GitHub → Settings → Secrets and variables → Actions, add:

| Secret | Value |
|---|---|
| `STAGING_HOST` | server IP or hostname |
| `STAGING_USER` | `deploy` |
| `STAGING_SSH_KEY` | a private key (`ssh-keygen -t ed25519 -f bos-deploy`), whose `.pub` is in `/home/deploy/.ssh/authorized_keys` |
| `STAGING_PORT`, `STAGING_DIR` | optional (22, `/opt/bos`) |

Then `git push origin main:staging` deploys what's on main.

## 4. Email

- `SMTP_URL` empty: nothing leaves the server; Mailpit catches every email. To read them in a browser, follow `deploy/caddy-extra/mailpit.caddy.example` (its own subdomain, behind a password).
- Real delivery: set `SMTP_URL` (e.g. `smtps://USER:PASS@smtp.zeptomail.in:465`) and an `EMAIL_FROM` on a domain you've verified with the provider (SPF and DKIM), then `dc up -d api`.

## 5. Backups

```bash
crontab -e
15 2 * * * /opt/bos/deploy/backup.sh >> /var/log/bos-backup.log 2>&1
```

Each night it saves the database (`db-*.dump`) and uploaded files (`storage-*.tgz`) to `BACKUP_DIR`, keeps `BACKUP_KEEP_DAYS` days, and, with `BACKUP_RCLONE_TARGET` set (`apt install rclone && rclone config`), copies them off the server. A backup on the same server doesn't survive losing the server: set up the off-site copy before real data goes in.

**Restore** (test it once):

```bash
dc stop api web
dc exec -T db psql -U bos -d postgres -c 'DROP DATABASE bos WITH (FORCE)' -c 'CREATE DATABASE bos'
dc exec -T db pg_restore -U bos -d bos --no-owner < /var/backups/bos/db-YYYYMMDD-HHMMSS.dump
dc run --rm -T --no-deps --entrypoint sh api -c 'rm -rf /data/storage/* && tar xzf - -C /data' < /var/backups/bos/storage-YYYYMMDD-HHMMSS.tgz
dc up -d
```

The restored database needs the same `MFA_KEY` as when it was backed up.

## 6. Day to day

| | |
|---|---|
| Logs | `dc logs -f --tail 100 api` |
| Status | `dc ps` |
| Database shell | `dc exec db psql -U bos bos` |
| Restart one service | `dc restart api` |
| Reset staging to fresh demo data | `dc down -v && dc up -d --build` (**deletes everything**, including certificates) |
| Disk used by old images | `docker system df`, `docker image prune` |

## Before real customers

- `SEED_DEMO=false` and `DEMO_MODE=false` on a fresh database (or reset the staging one).
- Real `SMTP_URL`, and `EMAIL_FROM` on your own domain.
- Off-site backups running, and a restore tested.
- Second instance or managed Postgres when one server isn't enough: run more API containers with `WORKERS=off` on all but one (BullMQ jobs then run once), and point `DATABASE_URL`/`REDIS_URL` at managed services.

# Production Docker deployment

The production Compose stack keeps PostgreSQL private, routes channel traffic
through an SSRF-aware Smokescreen proxy, publishes Alphorn only on localhost,
rotates container logs, and waits for health checks before starting dependent
services.

## Requirements

- Docker Engine with Docker Compose v2
- A Linux VPS with a reverse proxy such as 1Panel/OpenResty, Caddy, or Nginx
- A DNS hostname with HTTPS
- At least 1 GB of free memory

## 1. Prepare the environment

```bash
git clone --branch selfhost https://github.com/Yeats33/alphorn.git
cd alphorn
cp deploy/compose/.env.example deploy/compose/.env
chmod 600 deploy/compose/.env
```

Generate two different secrets and place them in
`deploy/compose/.env`:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Use one value for `POSTGRES_PASSWORD` and the other for
`BETTER_AUTH_SECRET`. Set `BETTER_AUTH_URL` to the final HTTPS URL. Hex
values are recommended because they do not require URL escaping.

## 2. Validate and start the VPS stack

```bash
docker compose \
  --env-file deploy/compose/.env \
  -f deploy/compose/compose.yml \
  -f deploy/compose/compose.vps.yml \
  config --quiet

docker compose \
  --env-file deploy/compose/.env \
  -f deploy/compose/compose.yml \
  -f deploy/compose/compose.vps.yml \
  up -d --build
```

The application listens only on `127.0.0.1:3000` by default. PostgreSQL and
Smokescreen have no host ports.

## 3. Configure the reverse proxy

For 1Panel, create a **Reverse Proxy** website:

- Primary domain: the hostname in `BETTER_AUTH_URL`
- Proxy address: `http://127.0.0.1:3000`
- HTTPS: enabled
- HTTP to HTTPS redirect: enabled

For custom Nginx/OpenResty configurations, preserve these headers and disable
buffering for the SSE stream:

```nginx
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_buffering off;
proxy_read_timeout 3600s;
```

Do not put HTTP Basic Auth in front of the entire hostname unless webhook
clients also send those credentials. Alphorn's public receivers live under
`/n/*`.

## Health and logs

```bash
curl -fsS https://notify.example.com/api/health

docker compose \
  --env-file deploy/compose/.env \
  -f deploy/compose/compose.yml \
  -f deploy/compose/compose.vps.yml \
  ps

docker compose \
  --env-file deploy/compose/.env \
  -f deploy/compose/compose.yml \
  -f deploy/compose/compose.vps.yml \
  logs -f --tail=200 alphorn
```

## Backup before upgrades

Database migrations run automatically when the Alphorn container starts. Take
a backup before pulling and rebuilding:

```bash
mkdir -p backups
chmod 700 backups

docker compose \
  --env-file deploy/compose/.env \
  -f deploy/compose/compose.yml \
  -f deploy/compose/compose.vps.yml \
  exec -T db pg_dump -U alphorn -d alphorn -Fc \
  > backups/alphorn-$(date -u +%Y%m%dT%H%M%SZ).dump
```

Protect the dump like a secret: channel credentials are stored in the database.

## Upgrade

```bash
git fetch origin
git switch selfhost
git pull --ff-only origin selfhost

docker compose \
  --env-file deploy/compose/.env \
  -f deploy/compose/compose.yml \
  -f deploy/compose/compose.vps.yml \
  build --pull

docker compose \
  --env-file deploy/compose/.env \
  -f deploy/compose/compose.yml \
  -f deploy/compose/compose.vps.yml \
  up -d
```

Verify `/api/health` and the migration log before deleting older images or
backups.

## Security properties

- PostgreSQL is reachable only on an internal Docker network.
- Alphorn binds to loopback in VPS mode.
- Outbound channel requests use Stripe Smokescreen to block private and
  non-routable destinations.
- Runtime containers use `no-new-privileges`.
- Docker JSON logs rotate at 10 MB with three files per service.
- Secrets stay in the ignored `deploy/compose/.env` file.

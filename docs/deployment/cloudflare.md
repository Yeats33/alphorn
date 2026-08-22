# Cloudflare deployment

Alphorn itself runs in Docker. Cloudflare provides DNS, TLS, WAF, and optional
outbound-only Tunnel ingress. The full application is not a Workers/Pages
deployment: it requires a persistent Node.js worker, PostgreSQL, database
migrations, and pg-boss background jobs.

Two supported Cloudflare topologies are described below.

## Option A: proxied DNS with a VPS reverse proxy

Use this when 1Panel/OpenResty, Caddy, or Nginx already owns ports 80 and 443.

1. Start the [VPS Docker stack](./docker.md).
2. Create an orange-cloud DNS record for the application hostname.
3. Reverse proxy the hostname to `http://127.0.0.1:3000`.
4. Use **Full (strict)** SSL/TLS mode after the origin certificate is active.
5. Keep PostgreSQL and port 3000 closed to the public Internet.

## Option B: Cloudflare Tunnel

Cloudflare Tunnel uses outbound-only connections, so the origin does not need
public 80/443 listeners. Cloudflare recommends remotely managed tunnels for
Docker deployments:

- [Cloudflare Tunnel overview](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)
- [Official Docker token command](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/update-cloudflared/)

### 1. Create the tunnel

In Cloudflare Zero Trust:

1. Go to **Networks → Tunnels**.
2. Create a remotely managed `cloudflared` tunnel.
3. Add a public hostname such as `notify.example.com`.
4. Set its service URL to `http://alphorn:3000`.
5. Copy the connector token.

### 2. Configure Alphorn

```bash
cp deploy/compose/.env.example deploy/compose/.env
chmod 600 deploy/compose/.env
```

Set:

```dotenv
BETTER_AUTH_URL=https://notify.example.com
CLOUDFLARED_TOKEN=replace-with-the-connector-token
```

Also replace `POSTGRES_PASSWORD` and `BETTER_AUTH_SECRET` with different
random values.

### 3. Start the Tunnel stack

Do not include `compose.vps.yml`; Tunnel mode intentionally publishes no host
ports.

```bash
docker compose \
  --env-file deploy/compose/.env \
  -f deploy/compose/compose.yml \
  -f deploy/compose/compose.cloudflare.yml \
  config --quiet

docker compose \
  --env-file deploy/compose/.env \
  -f deploy/compose/compose.yml \
  -f deploy/compose/compose.cloudflare.yml \
  up -d --build
```

`cloudflared` shares only the internal ingress network with Alphorn and uses a
separate network for outbound Tunnel connections.

### 4. Verify

```bash
curl -fsS https://notify.example.com/api/health

docker compose \
  --env-file deploy/compose/.env \
  -f deploy/compose/compose.yml \
  -f deploy/compose/compose.cloudflare.yml \
  logs --tail=200 cloudflared
```

## Recommended Cloudflare rules

- **Cache:** bypass cache for the application hostname. Webhook responses,
  authentication, dashboard pages, and SSE are dynamic.
- **WAF:** allow the HTTP methods your senders require. Alphorn receivers use
  `POST /n/*`.
- **Rate limiting:** rate-limit leaked or abusive webhook URLs, but leave enough
  burst capacity for monitoring systems.
- **Access:** do not protect all `/n/*` routes with interactive Cloudflare
  Access. If Access is required, add a bypass or service-token policy for
  webhook callers.
- **Request size:** keep Cloudflare limits above `WEBHOOK_MAX_BODY_BYTES`
  (1 MiB by default) so Alphorn remains the authoritative limit.
- **Origin exposure:** with Tunnel mode, close inbound application ports. The
  connector reaches Cloudflare over outbound connections.

For HTTP requests through Tunnel, Cloudflare documents
`CF-Connecting-IP` as the original client IP header. Preserve Cloudflare's
forwarded headers if another proxy is inserted between `cloudflared` and
Alphorn.

## Token handling and upgrades

- Never commit `CLOUDFLARED_TOKEN`.
- Rotate the connector token if it appears in shell history, logs, or chat.
- The Compose overlay follows Cloudflare's official `latest` container
  recommendation and sets `pull_policy: always`.
- For zero-downtime Tunnel upgrades, run multiple connectors for the same
  tunnel before replacing the old one.

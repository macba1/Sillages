# Postiz self-hosted — deploy + connect (for Tony)

Postiz (github.com/gitroomhq/postiz-app) publishes our Instagram content. The
Sillages backend talks to it via REST. This doc = exact steps. ~30–45 min.

## What it needs
- 1 container: Postiz (image `ghcr.io/gitroomhq/postiz-app:latest`)
- PostgreSQL (its OWN db — do NOT reuse Supabase)
- Redis
- ~2GB RAM / 2 vCPU

## Option A — Railway (recommended)
1. Railway → existing Sillages project → **New** → **Database → Add PostgreSQL**. Name it `postiz-db`.
2. **New → Database → Add Redis**. Name it `postiz-redis`.
3. **New → Empty Service** → name `postiz`. Source = Docker image `ghcr.io/gitroomhq/postiz-app:latest`.
4. On the `postiz` service → **Variables**, set:
   ```
   DATABASE_URL           = ${{postiz-db.DATABASE_URL}}
   REDIS_URL              = ${{postiz-redis.REDIS_URL}}
   JWT_SECRET             = <run: openssl rand -hex 32>
   FRONTEND_URL           = https://<your-postiz-domain>
   NEXT_PUBLIC_BACKEND_URL= https://<your-postiz-domain>
   BACKEND_INTERNAL_URL   = http://localhost:3000
   STORAGE_PROVIDER       = local
   ```
   (If Railway gives the service domain `postiz-xxxx.up.railway.app`, use that for both URL vars.)
5. **Settings → Networking → Generate Domain** (or set `postiz.sillages.app` via CNAME). Put that domain into `FRONTEND_URL` + `NEXT_PUBLIC_BACKEND_URL`, redeploy.
6. Open the domain → create the admin account.

> If Railway fights you for >1h (multi-service Docker can be finicky): fall back to
> **Postiz Cloud** (`api.postiz.com`) — same API, paid — or a $5 Hetzner/DO VPS with
> the official `docker-compose.yaml` from `gitroomhq/postiz-docker-compose`.

## The 2 manual steps only you can do
1. **Connect Instagram**: in the Postiz UI → **Channels / Add channel → Instagram** → log in with the Sillages IG account, authorize. (Instagram needs a Business/Creator account linked to a Facebook page.)
2. **API key**: Postiz UI → **Settings → Public API** → generate key → send it to me.

## Then I set backend env (Railway → Sillages backend service)
```
POSTIZ_API_URL        = https://<your-postiz-domain>
POSTIZ_API_KEY        = <the key you generated>
POSTIZ_INTEGRATION_ID = (optional — I auto-resolve the IG channel if omitted)
USE_DYNAMIC_CONTENT   = true     # only flip this ON after a test post is verified
```

## Verify
- `GET https://<domain>/public/v1/integrations` with `Authorization: <key>` returns the IG channel → wiring works.
- I run the content dry-run, then schedule ONE post as a future slot; you review it in the Postiz calendar before it goes out.

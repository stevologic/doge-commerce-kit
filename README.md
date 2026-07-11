# doge-commerce-kit

**DOGE Commerce Kit** — the free, open-source Dogecoin commerce toolkit, live at [commerce.dog](https://commerce.dog). A consolidated Django site built around direct Dogecoin acceptance:

- `Start` - short explanation, Donate DOGE modal, and links into the working tools
- `Wallet` - generate a local/dev Dogecoin wallet, load WIF, save watch-only browser state, and query blockchain balances
- `POS Terminal` - browser-stored merchant wallet, local QR generation, order state, and local receipt list
- `Tools` - QR generator, self-contained Dogecoin Accepted snippet, Donate DOGE snippet, simplified kit examples, and testable validation
- `Statistics` - Coinbase DOGE-USD live ticker, candles, moving averages, standard deviation, trade tape, and rich-list distribution
- `Playbook` - business readiness checklists and simplified market adoption examples
- `FAQ` - plain-language merchant and builder answers
- `Technical` - Dogecoin URI notes, QR endpoint, Coinbase/Robinhood integration notes, reusable data files, and webhook demo instructions

The site stays inside a lawful adoption lane:

- no price promises
- no coordinated buying or selling
- no hidden paid promotion
- no fake merchant proof
- no custody of customer or merchant funds

Current adoption expansion is now expressed as lightweight kit examples inside the Playbook and Tools pages rather than a large multi-page campaign workflow.

## Deploy to Production (DigitalOcean droplet or any Docker host)

The compose stack ships two services: `web` (Django behind gunicorn, non-root,
health-checked) and `caddy` (TLS termination with automatic Let's Encrypt
certificates). The app port is bound to loopback only; all public traffic
enters through Caddy on 80/443.

1. Point your domain's A/AAAA records at the server, and open ports 80 + 443.
2. Clone the repo and create the environment file:

   ```bash
   cp .env.example .env
   python3 -c "import secrets; print(secrets.token_urlsafe(50))"   # paste into DJANGO_SECRET_KEY
   ```

   The example file already targets production at `commerce.dog`
   (`DOGE_DOMAIN`, `DOGE_SITE_URL`, `LETSENCRYPT_EMAIL`) — adjust if you
   deploy elsewhere.

3. Launch:

   ```bash
   docker compose up -d --build
   ```

   Caddy obtains the certificate automatically on first request. Verify with
   `curl -I https://your-domain/health/`.

Production notes:

- The container refuses to boot with a missing or default `DJANGO_SECRET_KEY`.
- `/api/` endpoints are rate limited per client IP (`DOGE_API_RATE_LIMIT`,
  default 60/min per gunicorn worker).
- HSTS is on by default (`DJANGO_HSTS_SECONDS=31536000`); set it to `0` while
  testing DNS if needed.
- For real traffic, configure a Blockbook indexer (below) — the public
  BlockCypher demo fallback throttles quickly.
- Update flow: `git pull && docker compose up -d --build`.

## Run With Docker (local)

```powershell
cp .env.example .env   # set DJANGO_SECRET_KEY (any long random string) and DOGE_DOMAIN=localhost
docker compose up --build
```

With `DOGE_DOMAIN=localhost`, Caddy serves `https://localhost` using a
self-signed local certificate (accept the browser warning), and the app is
also reachable directly at `http://127.0.0.1:42069`.

To reproduce the build verification logs locally:

```powershell
$env:DOGE2MOON_SCRATCH = ".\verify-artifacts"
python tools\verify_build.py
```

Then visit:

```text
http://localhost:42069
```

### Dogecoin Blockchain Lookup Provider

Wallet balances, recent transactions, POS activity, and transaction validation can use a Blockbook-compatible Dogecoin indexer instead of a throttled public demo API:

```powershell
$env:DOGE_BLOCKBOOK_BASE_URL="https://your-dogecoin-indexer.example"
$env:DOGE_BLOCKCHAIN_PROVIDER_NAME="Your Dogecoin indexer"
$env:DOGE_BLOCKBOOK_API_KEY="optional-provider-key"
docker compose up --build
```

If `DOGE_BLOCKBOOK_BASE_URL` is not configured, the app keeps a short cached BlockCypher demo fallback for local testing. Set `DOGE_ENABLE_BLOCKCYPHER_FALLBACK=false` to disable the public fallback entirely.

## Run Locally

```powershell
python -m pip install -r requirements.txt
python manage.py runserver 42069
```

For the full test suite (browser + MiniRacer wallet/rate tests):

```powershell
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
python manage.py test commerce.tests
```

Then visit:

```text
http://127.0.0.1:42069
```

## Project Structure

- `manage.py` - Django command entry point
- `doge2moon/` - Django project settings and root URLs
- `commerce/` - consolidated site app
- `commerce/templates/commerce/` - primary pages
- `commerce/templates/commerce/quick_commerce_kits.html` - reusable quick-kit finder and kit handoff partial
- `commerce/static/commerce/css/site.css` - shared interface styling
- `commerce/static/commerce/js/site.js` - shared browser tools
- `commerce/static/commerce/js/offramp.js` - DOGE-to-USD conversion planner
- `commerce/static/commerce/data/` - reusable JSON and CSV templates
- `Dockerfile` - production container build
- `docker-compose.yml` - local container orchestration

The original static files remain in the repository as source material, but the Django app is the primary runnable site.

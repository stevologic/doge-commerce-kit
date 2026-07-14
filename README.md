# doge-commerce-kit

**DOGE Commerce Kit** — the free, open-source Dogecoin commerce toolkit, live at [commerce.dog](https://commerce.dog). A consolidated Django site with a single, focused job: let any person or small business accept Dogecoin for goods and services — at the counter and on their website or shop.

![DOGE Commerce Kit home page](docs/readme/home.png)

Everything runs in the browser against a stateless Django backend — no accounts, no processor fees, no custody. The primary navigation is the acceptance workflow (`Start`, `POS Terminal`, `Tools`, `Playbook`, `FAQ`); `Statistics` and `Technical` are secondary references linked from the footer.

- `Start` - what the kit is, the core accept-in-person and accept-online tools, and role-based entry paths
- `POS Terminal` - one screen designed to be usable by anyone: set your business name and receiving wallet up top (generate a new Dogecoin wallet with a one-time key backup, or paste your own address), type a USD price, add a memo (with a typeahead that remembers the notes you've used), and show a scannable DOGE QR or full-screen customer display. A small Dogecoin network fee is added automatically and shown in the payment details; verify payment on chain and keep an exportable local order ledger
- `Tools` - an app-store style marketplace: browse tools as tappable app tiles (payment QR builder, postable wallet card, printable "Dogecoin accepted here" counter sign, accepted badge, donate button, live price and spark-chart snippets, website integration pieces, transaction validation, receipts, and checkout policy) — each opens in place and auto-fills from the saved wallet
- `Playbook` - a short, practical how-to for accepting DOGE with the kit's tools: benefits, three acceptance routes, a four-step checkout runbook, launch checklist, and printables
- `FAQ` - plain-language merchant and builder answers with primary sources
- `Statistics` *(footer link)* - live dashboard: Coinbase DOGE-USD price with animated sparkline over a three.js starfield, KPI strip, candles with moving averages, trade tape, plain-English technical analysis (RSI, MACD, Bollinger, support/resistance, volatility), capital map, and rich-list distribution
- `Technical` *(footer link)* - sticky section navigator, wallet key derivation, payment URI/QR reference, chain lookup config, copyable code blocks, reusable data files, webhook demo, and papers

The site stays inside a lawful adoption lane:

- no price promises
- no coordinated buying or selling
- no hidden paid promotion
- no fake merchant proof
- no custody of customer or merchant funds

Current adoption expansion is now expressed as lightweight kit examples inside the Playbook and Tools pages rather than a large multi-page campaign workflow.

## Screenshots

### POS Terminal — price in dollars, get paid in DOGE

Quote a sale in USD with quick-amount chips, show the customer a scannable QR
(or flip to a full-screen customer display), verify the payment on chain, and
keep a local order ledger.

![POS terminal](docs/readme/pos-terminal.png)

### Live market dashboard

Real-time Coinbase price with an animated sparkline over a three.js starfield,
KPI strip, candles with moving averages, and a live trade tape.

![Statistics dashboard](docs/readme/statistics.png)

Classic indicators — RSI, MACD, Bollinger position, support/resistance,
volatility — computed live from the loaded candles, each with a plain-English
read and a one-line market summary.

![Technical analysis panel](docs/readme/technical-analysis.png)

### Snippet marketplace

Copy self-contained website snippets, badges, receipts, and printable counter
signs that auto-fill from the wallet saved in the POS Terminal — where you can
generate a new wallet (with a one-time key backup) or paste your own address.

![Tools](docs/readme/tools.png)

## Embed the live DOGE checkout

The **Tools → Live website checkout** builder generates a portable three-stage
checkout. Paste its script and custom element into any page, replacing the
example address and order details with your own:

```html
<script async src="https://commerce.dog/static/commerce/js/doge_checkout.js"></script>
<doge-checkout
  merchant="Example Coffee"
  address="YOUR_DOGECOIN_RECEIVING_ADDRESS"
  offer="Coffee order"
  usd="10.00"
  memo="Web order 123"
  order-id="order-123"
  confirmations="1"
  quote-minutes="10"
  button-text="Continue with DOGE"
  return-url="https://example.com/thanks">
</doge-checkout>
```

The customer reviews a fresh USD-to-DOGE quote, scans or opens the frozen
payment request, then sees detection and confirmation progress automatically.
The final stage shows either a verified receipt or a clear merchant-review
state. The quote includes the same small network-fee cushion used by the POS.

### Checkout attributes

| Attribute | Purpose |
| --- | --- |
| `merchant` | Business name shown in checkout. |
| `address` | Required public Dogecoin mainnet receiving address. |
| `offer`, `usd`, `memo` | Customer-facing order description, USD amount, and wallet memo. |
| `order-id` | Optional host-side reference included in events and the receipt; it is not an on-chain identifier. |
| `confirmations` | Confirmations required before verified, from `0` to `12` (default `1`). |
| `quote-minutes` | Frozen quote window, from `1` to `30` minutes (default `10`). |
| `button-text` | Stage-one call-to-action text. |
| `return-url` | Optional HTTPS destination shown after verification. |
| `embed-url` | Advanced HTTP(S) override when self-hosting the checkout frame. |

Changing attributes or calling `update()` rebuilds the checkout only before
payment begins. Once stage two freezes the quote, restart first or mount a new
checkout; `configure()` / `update()` reject mid-payment changes.

### Events and methods

Checkout lifecycle events bubble from the `<doge-checkout>` element. Every
event detail includes `version`, `instanceId`, `orderId`, and `advisory: true`.

```js
const checkout = document.querySelector("doge-checkout");

const stopListening = checkout.on("verified", ({ detail }) => {
  console.log(detail.txid, detail.matchedDoge, detail.confirmations);
  // Revalidate these values on your server before automatic fulfillment.
});

checkout.addEventListener("dogecheckout:reviewrequired", ({ detail }) => {
  console.log("Merchant review needed", detail);
});
```

Events: `ready`, `quote`, `stagechange`, `paymentdetected`,
`verificationpending`, `verified`, `reviewrequired`, `expired`, `error`, and
`state`. The `quote` event reports whether the quote is frozen.

Methods: `configure(config)` and `update(config)` apply new attributes;
`restart()` creates a fresh quote; `refresh()` requests an immediate quote or
chain check; `getState()` returns the latest cached public state; `on(name,
handler)` returns an unsubscribe function; and `destroy()` removes the embed.
JavaScript integrations can also call `DogeCheckout.mount(target, config)`.

### Production boundaries

- A browser `verified` event is advisory. Before releasing goods, downloads,
  credits, or other automated fulfillment, revalidate the transaction ID,
  receiving address, exact DOGE amount, and confirmation count on your server.
- A memo and `order-id` do not uniquely identify an on-chain payment. Automated
  stores with concurrent orders should issue a unique receiving address per
  order or use a server-side invoice/processor flow. A shared address is best
  for low-volume or manually fulfilled checkout.
- The embed needs only a public receiving address. Never place a WIF, private
  key, seed phrase, or mnemonic in HTML, attributes, events, or API requests.
- Public address lookups reveal wallet activity and the hosted APIs are rate
  limited. Higher-volume deployments should use their own Dogecoin indexer and
  server-side order system.
- Sites with a strict Content Security Policy must allow
  `https://commerce.dog` in `script-src`, `style-src`, and `frame-src` (or the
  equivalent self-hosted origin). No broad API CORS permission is required.

### Playbook

Checklists, printables, and a runbook that turn Dogecoin acceptance into a
counter-ready workflow.

![Playbook routes](docs/readme/playbook.png)

## Deploy to Production (DigitalOcean droplet or any Docker host)

The compose stack ships two services: `web` (Django behind gunicorn, non-root,
health-checked) and `caddy` (TLS termination with automatic Let's Encrypt
certificates). The app port is bound to loopback only; all public traffic
enters through Caddy on 80/443.

1. Point A/AAAA records at the server for every hostname you want served, and
   open ports 80 + 443. The bundled config expects four: `commerce.dog`
   (canonical, serves the app) plus `www.commerce.dog`, `doge-commerce-kit.com`,
   and `www.doge-commerce-kit.com` (each gets its own certificate and redirects
   to the canonical). Adjust `DOGE_REDIRECT_DOMAINS` in `.env` for a different set.
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

- Requires Docker Compose v2 (`docker compose`). The legacy Python
  `docker-compose` 1.29 from old apt packages crashes on modern Docker
  Engines with `KeyError: 'ContainerConfig'` when recreating containers —
  install `docker-compose-plugin` (or `docker-compose-v2` on Ubuntu) and
  stop using the v1 binary. `deploy.sh` refuses the broken combination
  automatically.
- The container refuses to boot with a missing or default `DJANGO_SECRET_KEY`.
- `/api/` endpoints are rate limited per client IP (`DOGE_API_RATE_LIMIT`,
  default 60/min per gunicorn worker).
- HSTS is on by default (`DJANGO_HSTS_SECONDS=31536000`); set it to `0` while
  testing DNS if needed.
- For real traffic, configure a Blockbook indexer (below) — the public
  BlockCypher demo fallback throttles quickly.
- Update flow (manual): `git pull && docker compose up -d --build`.
- Update flow (automatic): `deploy.sh` fetches the branch and rebuilds only when
  there is a new commit. Make it executable and add it to cron:

  ```bash
  chmod +x deploy.sh
  ./deploy.sh                 # run once to confirm it works
  crontab -e                  # use `sudo crontab -e` if Docker requires root
  #   */5 * * * * /full/path/to/doge-commerce-kit/deploy.sh >/dev/null 2>&1
  ```

  It logs to `deploy.log`, guards against overlapping runs, and does nothing
  (one log line) when the repo is already up to date. `./deploy.sh --force`
  rebuilds regardless.

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
- `doge2moon/` - Django project settings (production hardening lives here) and root URLs
- `commerce/` - consolidated site app
- `commerce/middleware.py` - per-IP rate limiting for `/api/` endpoints
- `commerce/templates/commerce/` - primary pages
- `commerce/static/commerce/css/site.css` - shared interface styling
- `commerce/static/commerce/js/site.js` - shared page tools (snippet builders, filters, code copy)
- `commerce/static/commerce/js/doge_tools.js` - wallet, POS, statistics, and technical-analysis logic
- `commerce/static/commerce/js/wallet_core.js` - client-side key derivation and transaction signing
- `commerce/static/commerce/js/stats_dashboard.js` - d3 price sparkline for the statistics header
- `commerce/static/commerce/js/stats_visuals.js` - three.js starfield accent behind the statistics header
- `commerce/static/commerce/vendor/` - self-hosted d3, topojson, and three.js
- `commerce/static/commerce/data/` - reusable JSON and CSV templates
- `Dockerfile` - production container build (non-root, healthcheck, tuned gunicorn)
- `docker-compose.yml` - production stack: web + Caddy TLS termination
- `Caddyfile` - automatic Let's Encrypt for commerce.dog
- `.env.example` - documented production environment template
- `docs/` - product spec, legal guardrails, release checklist, and README screenshots

The original static prototypes remain in the repository as source material, but the Django app is the primary runnable site.

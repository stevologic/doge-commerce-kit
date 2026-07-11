# Release Checklist

Use this gate before public launch and after significant releases at
[commerce.dog](https://commerce.dog).

## Product

- All eight pages return 200: `/`, `/wallet/`, `/pos/`, `/merchant-kit/`,
  `/statistics/`, `/playbook/`, `/faq/`, `/technical-details/`.
- DOGE price loads on POS/Tools/Statistics, or clearly falls back.
- POS: quick-amount chips update the QR, customer display opens full screen,
  txid confirmation works, orders save/export/delete locally.
- Wallet: create/import works, receive QR renders, send flow shows the inline
  confirm step and the submitted-transaction tracker after broadcast.
- Tools: every snippet builder previews and copies; the counter sign prints;
  saved wallet auto-fills builders.
- Statistics: live feed connects, sparkline draws, candles + technical
  analysis render, holder distribution loads.
- No browser pop-ups anywhere (`window.confirm/alert/prompt` count is zero).
- `python manage.py test commerce.tests` passes (browser tests need
  `requirements-dev.txt` + `playwright install chromium`).

## Deployment

- `.env` has a generated `DJANGO_SECRET_KEY` (container refuses defaults).
- `DOGE_DOMAIN`, `DOGE_SITE_URL`, `LETSENCRYPT_EMAIL` point at production.
- `docker compose up -d --build` healthy; `curl -I https://commerce.dog/health/`
  returns 200 over TLS.
- HSTS, X-Frame-Options, referrer-policy headers present on responses.
- `/api/` rate limiting returns 429 after the configured burst.
- Blockbook indexer configured (`DOGE_BLOCKBOOK_BASE_URL`) for real traffic.
- Canonical URLs, sitemap.xml, robots.txt, and llms.txt resolve on the
  production domain.

## Legal And Trust

- No price guarantee in public materials.
- No coordinated buy language.
- No hidden paid promotion.
- No fake transaction incentives.
- No custody of customer funds.
- All sponsor relationships disclosed.
- Statistics page labeled as market context, not investment advice.

## Launch Day

- Publish the app and confirm the GitHub repo (footer Contribute link) is live.
- Announce with verifiable claims only.
- Invite merchants to run one real checkout via the Playbook.
- Track every claim that needs later proof.

## Six-Month Confidence Gate

Do not claim confidence in a `$1.00` outcome unless the campaign has evidence of
scale beyond normal community promotion:

- Thousands of active merchants, not just pledges.
- Repeated monthly DOGE payment volume growth.
- Processor or ecommerce integrations live.
- Public proof reports cited outside the Dogecoin community.
- Transparent creator and nonprofit participation.
- Sustained demand independent of one celebrity, exchange, or news cycle.

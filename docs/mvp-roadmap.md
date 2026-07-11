# DOGE Commerce Kit Roadmap

## Shipped (live at commerce.dog)

The consolidated Django site replaced the original static operator MVP and
covers the first two phases of the original plan without requiring accounts
or a merchant database:

- POS terminal: built-in wallet setup (generate with one-time key backup or
  paste an address), USD quotes with quick amounts, scannable QR, full-screen
  customer display, on-chain confirmation, exportable local order ledger
- snippet marketplace: payment QR builder, wallet share card, printable
  counter sign, accepted badge, donate button, price/spark snippets,
  integration pieces, validation, receipts, checkout policy
- statistics dashboard: live Coinbase feed, sparkline, candles + moving
  averages, plain-English technical analysis, capital map, holder distribution
- playbook with printables (counter sign, cashier quick card), FAQ, and a
  technical reference with copyable code
- production stack: Caddy TLS with automatic Let's Encrypt, hardened Django
  settings, per-IP API rate limiting, non-root container with healthchecks

## Next

Build direct merchant integrations.

- Shopify app or extension
- WooCommerce plugin
- simple hosted checkout page
- event mode for fast in-person checkout
- webhook-driven order confirmation beyond the bundled demo receiver

## Later

Build distribution and reporting.

- city-cluster directory
- merchant map
- proof report generator
- launch partner dashboard

## Risks To Manage

- merchants may want instant fiat conversion before launch
- staff training burden can kill in-person pilots
- scattered pilots are weaker than concentrated density
- wallet setup friction can stall non-technical merchants
- public messaging can drift into speculation if not controlled

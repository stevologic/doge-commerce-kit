# DOGE POS Webhook Demo

Small local Python service for testing POS order callbacks.

## Run

```bash
docker compose up --build
```

## Test

```bash
curl -X POST http://localhost:42100/webhook/payment \
  -H "Content-Type: application/json" \
  -d "{\"order_id\":\"demo-1\",\"status\":\"paid\",\"txid\":\"sample\"}"
```

Then open:

```text
http://localhost:42100/api/orders
```

This project does not custody DOGE. It only receives JSON events.

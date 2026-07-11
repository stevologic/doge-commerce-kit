import json
import os
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request


app = Flask(__name__)
DATA_FILE = Path(os.environ.get("DOGE_POS_DATA", "/data/orders.json"))


def read_orders():
    if not DATA_FILE.exists():
        return []
    try:
        return json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []


def write_orders(orders):
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(json.dumps(orders[:200], indent=2), encoding="utf-8")


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/api/orders")
def list_orders():
    return jsonify({"orders": read_orders()})


@app.post("/webhook/payment")
def payment_webhook():
    payload = request.get_json(silent=True) or {}
    order = {
        "received_at": datetime.now(timezone.utc).isoformat(),
        "order_id": payload.get("order_id") or payload.get("id") or "unknown",
        "status": payload.get("status") or "received",
        "txid": payload.get("txid") or payload.get("transaction_id") or "",
        "amount_doge": payload.get("amount_doge") or payload.get("doge") or "",
        "raw": payload,
    }
    orders = read_orders()
    orders.insert(0, order)
    write_orders(orders)
    return jsonify({"accepted": True, "order": order}), 202


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=42100)

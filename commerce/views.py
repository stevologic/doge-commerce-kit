import base64
import hashlib
import json
import os
import re
import time
from decimal import Decimal, InvalidOperation
from io import BytesIO
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from xml.sax.saxutils import escape as xml_escape

import qrcode
import qrcode.image.svg
from django.views.decorators.csrf import csrf_exempt
from django.http import HttpResponse, JsonResponse
from django.shortcuts import render
from django.templatetags.static import static


DONATION_ADDRESS = "DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK"
BLOCKCHAIR_BASE_URL = "https://api.blockchair.com/dogecoin"
BLOCKCHAIR_PROVIDER_NAME = "Blockchair"
BLOCKCYPHER_BALANCE_URL = "https://api.blockcypher.com/v1/doge/main/addrs/{address}/balance"
BLOCKCYPHER_ADDRESS_URL = "https://api.blockcypher.com/v1/doge/main/addrs/{address}"
BLOCKCYPHER_TX_URL = "https://api.blockcypher.com/v1/doge/main/txs/{txid}"
BLOCKCYPHER_PUSH_URL = "https://api.blockcypher.com/v1/doge/main/txs/push"
DOGE_API_USER_AGENT = "DOGE-Commerce-Kit/1.0"
DOGE_BLOCKBOOK_BASE_URL = os.environ.get("DOGE_BLOCKBOOK_BASE_URL", "").rstrip("/")
DOGE_BLOCKBOOK_API_KEY = os.environ.get("DOGE_BLOCKBOOK_API_KEY", "")
DOGE_BLOCKBOOK_API_KEY_HEADER = os.environ.get("DOGE_BLOCKBOOK_API_KEY_HEADER", "api-key")
DOGE_ENABLE_BLOCKCYPHER_FALLBACK = os.environ.get("DOGE_ENABLE_BLOCKCYPHER_FALLBACK", "true").lower() not in {"0", "false", "no", "off"}
DOGE_BLOCKCHAIN_PROVIDER_NAME = os.environ.get("DOGE_BLOCKCHAIN_PROVIDER_NAME", "Dedicated Dogecoin indexer")
BLOCKCYPHER_PROVIDER_NAME = "BlockCypher demo fallback"
DOGE_EXPLORER_TX_URL = os.environ.get("DOGE_EXPLORER_TX_URL", "https://blockchair.com/dogecoin/transaction/{txid}")
try:
    DOGE_LOOKUP_CACHE_TTL = max(15, int(os.environ.get("DOGE_LOOKUP_CACHE_TTL", "90") or 90))
except (TypeError, ValueError):
    DOGE_LOOKUP_CACHE_TTL = 90
DOGE_LOOKUP_CACHE = {}
RICH_LIST_CACHE = {"loaded_at": 0, "payload": None}
BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
DOGE_ADDRESS_PREFIX = b"\x1e"
SITE_NAME = "DOGE Commerce Kit"
ASSET_VERSION = "20260711-classic-doge-hero-v1"
SERVER_RATE_STATE = {}
SITE_URL = os.environ.get("DOGE_SITE_URL") or os.environ.get("SITE_URL") or ""
SEO_KEYWORDS = (
    "Dogecoin commerce, accept Dogecoin, DOGE POS, Dogecoin QR code, "
    "Dogecoin wallet balance, Dogecoin merchant tools, DOGE payments, "
    "Dogecoin donation button, Dogecoin checkout, crypto commerce kit"
)
SEO_PAGES = [
    {
        "active": "home",
        "path": "/",
        "nav": "Start",
        "priority": "1.0",
        "changefreq": "weekly",
        "title": "DOGE Commerce Kit | Accept Dogecoin in a Few Minutes",
        "description": "Free MIT-licensed Dogecoin commerce kit for QR payments, POS checkout, wallet balance checks, snippets, adoption playbooks, and DOGE market stats.",
    },
    {
        "active": "pos_terminal",
        "path": "/pos/",
        "nav": "POS Terminal",
        "priority": "0.95",
        "changefreq": "weekly",
        "title": "Doge Point of Sale Terminal | Accept DOGE at Checkout",
        "description": "Doge Point of Sale Terminal for merchants: set a USD price, create DOGE QR requests, save local orders, validate transactions, and export records.",
    },
    {
        "active": "merchant_kit",
        "path": "/merchant-kit/",
        "nav": "Tools",
        "priority": "0.9",
        "changefreq": "weekly",
        "title": "Dogecoin QR Codes, Badges, and Donate Buttons | DOGE Commerce Kit",
        "description": "Build Dogecoin QR payment links, self-contained website badges, Donate DOGE snippets, and transaction validation checks.",
    },
    {
        "active": "statistics",
        "path": "/statistics/",
        "nav": "Statistics",
        "priority": "0.85",
        "changefreq": "daily",
        "title": "Live Dogecoin Market Statistics | DOGE Price, Volume, and Holders",
        "description": "Live DOGE-USD price, Coinbase trade tape, moving averages, technical analysis, holder distribution, and market flow charts.",
    },
    {
        "active": "playbook",
        "path": "/playbook/",
        "nav": "Playbook",
        "priority": "0.85",
        "changefreq": "weekly",
        "title": "How to Accept Dogecoin in Person and Online | DOGE Commerce Playbook",
        "description": "A practical Dogecoin acceptance playbook for client-side wallets, POS checkout QR codes, website snippets, transaction validation, receipts, and merchant records.",
    },
    {
        "active": "faq",
        "path": "/faq/",
        "nav": "FAQ",
        "priority": "0.8",
        "changefreq": "monthly",
        "title": "Dogecoin Commerce FAQ | Wallets, Confirmations, Taxes, and Security",
        "description": "Dogecoin commerce FAQ for merchants and builders covering wallets, confirmations, checkout, taxes, security, donations, and adoption.",
    },
    {
        "active": "technical_details",
        "path": "/technical-details/",
        "nav": "Technical",
        "priority": "0.75",
        "changefreq": "monthly",
        "title": "Dogecoin Payment URI, QR, Wallet, and Blockchain Technical Details",
        "description": "Technical Dogecoin commerce details: client-side wallet math, payment URI format, QR generation, validation, market feeds, reusable files, and blockchain reference papers.",
    },
]
SEO_BY_ACTIVE = {page["active"]: page for page in SEO_PAGES}


def site_base_url(request=None):
    if SITE_URL:
        return SITE_URL.rstrip("/")
    if request is not None:
        return request.build_absolute_uri("/").rstrip("/")
    return "http://localhost:42069"


def absolute_site_url(path, base_url):
    if path.startswith("http://") or path.startswith("https://"):
        return path
    return f"{base_url}/{path.lstrip('/')}"


def structured_data(active, base_url):
    page = SEO_BY_ACTIVE.get(active, SEO_BY_ACTIVE["home"])
    canonical_url = absolute_site_url(page["path"], base_url)
    breadcrumb_items = [
        {
            "@type": "ListItem",
            "position": 1,
            "name": SITE_NAME,
            "item": absolute_site_url("/", base_url),
        }
    ]
    if page["active"] != "home":
        breadcrumb_items.append(
            {
                "@type": "ListItem",
                "position": 2,
                "name": page["nav"],
                "item": canonical_url,
            }
        )
    return json.dumps(
        {
            "@context": "https://schema.org",
            "@graph": [
                {
                    "@type": "WebSite",
                    "@id": f"{base_url}/#website",
                    "name": SITE_NAME,
                    "url": base_url,
                    "description": SEO_BY_ACTIVE["home"]["description"],
                    "inLanguage": "en-US",
                },
                {
                    "@type": "SoftwareApplication",
                    "@id": f"{base_url}/#software",
                    "name": SITE_NAME,
                    "applicationCategory": "BusinessApplication",
                    "operatingSystem": "Web",
                    "url": base_url,
                    "license": "https://opensource.org/license/mit",
                    "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
                    "description": "A non-custodial Dogecoin commerce toolkit for merchants, builders, and local adoption experiments.",
                },
                {
                    "@type": "WebPage",
                    "@id": f"{canonical_url}#webpage",
                    "url": canonical_url,
                    "name": page["title"],
                    "description": page["description"],
                    "isPartOf": {"@id": f"{base_url}/#website"},
                    "about": {"@id": f"{base_url}/#software"},
                    "breadcrumb": {"@id": f"{canonical_url}#breadcrumb"},
                    "inLanguage": "en-US",
                },
                {
                    "@type": "BreadcrumbList",
                    "@id": f"{canonical_url}#breadcrumb",
                    "itemListElement": breadcrumb_items,
                },
            ],
        },
        separators=(",", ":"),
    )


def doge_logo_data_uri():
    path = Path(__file__).resolve().parent / "static" / "commerce" / "img" / "doge-logo-256.png"
    try:
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        return f"data:image/png;base64,{encoded}"
    except OSError:
        return ""


def parse_rich_list_doge(balance):
    match = re.search(r"([\d,]+(?:\.\d+)?)\s*DOGE", balance or "")
    if not match:
        return None
    try:
        return Decimal(match.group(1).replace(",", ""))
    except InvalidOperation:
        return None


def compact_doge(value):
    if value is None:
        return "Unknown DOGE"
    amount = Decimal(value)
    for divisor, suffix in (
        (Decimal("1000000000"), "B"),
        (Decimal("1000000"), "M"),
        (Decimal("1000"), "K"),
    ):
        if amount >= divisor:
            scaled = amount / divisor
            places = 2 if scaled < 10 else 1
            text = f"{scaled:.{places}f}".rstrip("0").rstrip(".")
            return f"{text}{suffix} DOGE"
    return f"{amount:,.0f} DOGE"


def rich_list_bucket_range(items, outside_cutoff=False):
    balances = [item.get("balance_doge") for item in items if item.get("balance_doge") is not None]
    if not balances:
        return "Range unavailable"
    low = min(balances)
    high = max(balances)
    if outside_cutoff:
        return f"under {compact_doge(high)}"
    if low == high:
        return compact_doge(high)
    return f"{compact_doge(low).replace(' DOGE', '')}-{compact_doge(high)}"


def sha256(data):
    return hashlib.sha256(data).digest()


def base58_decode(value):
    number = 0
    for char in value:
        number *= 58
        if char not in BASE58_ALPHABET:
            raise ValueError("Invalid Base58 character")
        number += BASE58_ALPHABET.index(char)
    data = number.to_bytes((number.bit_length() + 7) // 8, "big") if number else b""
    leading_zeroes = len(value) - len(value.lstrip("1"))
    return b"\0" * leading_zeroes + data


def base58check_decode(value):
    data = base58_decode(value)
    if len(data) < 5:
        raise ValueError("Base58Check value is too short")
    payload, checksum = data[:-4], data[-4:]
    if sha256(sha256(payload))[:4] != checksum:
        raise ValueError("Invalid Base58Check checksum")
    return payload


def valid_doge_address(address):
    if not re.fullmatch(r"[1-9A-HJ-NP-Za-km-z]{26,40}", address or ""):
        return False
    try:
        payload = base58check_decode(address)
    except ValueError:
        return False
    return payload[:1] in {DOGE_ADDRESS_PREFIX, b"\x16"} and len(payload) == 21


def doge_units(value):
    return round((int(value or 0) / 100_000_000), 8)


def doge_atoms(value):
    try:
        amount = Decimal(str(value or "0"))
    except InvalidOperation as exc:
        raise ValueError("DOGE amount must be numeric.") from exc
    if not amount.is_finite() or amount < 0:
        raise ValueError("DOGE amount must be positive.")
    return int(amount * Decimal("100000000"))


def safe_int(value, default=0):
    try:
        return int(value if value is not None else default)
    except (TypeError, ValueError):
        return default


def doge_atoms_from_chain(value):
    if value in (None, ""):
        return 0
    text = str(value).strip()
    try:
        if "." in text:
            amount = Decimal(text)
            if not amount.is_finite():
                return 0
            return int(amount * Decimal("100000000"))
        return int(text)
    except (InvalidOperation, ValueError, TypeError):
        return 0


def utc_now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def iso_from_epoch(value):
    try:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(int(value)))
    except (TypeError, ValueError):
        return ""


def fetch_json(url, timeout=12, headers=None):
    request_headers = {"User-Agent": DOGE_API_USER_AGENT}
    if headers:
        request_headers.update(headers)
    request_obj = Request(url, headers=request_headers)
    with urlopen(request_obj, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
        provider_key = "blockchair" if "blockchair.com" in url else "blockcypher" if "blockcypher.com" in url else ""
        if provider_key:
            record_server_rate(provider_key, response.headers)
        return payload


def post_json(url, body, timeout=12, headers=None):
    request_headers = {
        "User-Agent": DOGE_API_USER_AGENT,
        "Content-Type": "application/json",
    }
    if headers:
        request_headers.update(headers)
    data = json.dumps(body).encode("utf-8")
    request_obj = Request(url, data=data, headers=request_headers, method="POST")
    with urlopen(request_obj, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
        provider_key = "blockchair" if "blockchair.com" in url else "blockcypher" if "blockcypher.com" in url else ""
        if provider_key:
            record_server_rate(provider_key, response.headers)
        return payload


SERVER_THROTTLE_STATE = {}


def record_server_rate(provider_key, headers, *, status="ready", last_error=""):
    entry = SERVER_RATE_STATE.setdefault(
        provider_key,
        {"used": 0, "limit": 0, "updated_at": 0, "status": "ready", "last_error": ""},
    )
    if provider_key == "blockchair":
        count = headers.get("X-BC-Request-Count") or headers.get("x-bc-request-count")
        limit = headers.get("X-BC-Request-Limit") or headers.get("x-bc-request-limit")
        if count and limit:
            entry["used"] = int(count)
            entry["limit"] = int(limit)
    remaining = headers.get("X-RateLimit-Remaining") or headers.get("x-ratelimit-remaining")
    limit_header = headers.get("X-RateLimit-Limit") or headers.get("x-ratelimit-limit")
    if remaining and limit_header:
        entry["used"] = max(0, int(limit_header) - int(remaining))
        entry["limit"] = int(limit_header)
    entry["status"] = status
    entry["last_error"] = last_error
    entry["updated_at"] = time.time()


def mark_server_provider(source_key, provider_name, *, status="active"):
    entry = SERVER_RATE_STATE.setdefault(
        source_key,
        {"used": 0, "limit": 0, "updated_at": 0, "status": "ready", "last_error": "", "provider_name": ""},
    )
    entry["status"] = status
    entry["provider_name"] = provider_name
    entry["updated_at"] = time.time()


def throttle_server_provider(provider_key, min_interval=1.0):
    entry = SERVER_THROTTLE_STATE.setdefault(provider_key, {"last_request_at": 0})
    now = time.time()
    wait = min_interval - (now - entry.get("last_request_at", 0))
    if wait > 0:
        time.sleep(wait)
    entry["last_request_at"] = time.time()


def blockbook_api_url(path, params=None):
    if not DOGE_BLOCKBOOK_BASE_URL:
        raise ValueError("DOGE_BLOCKBOOK_BASE_URL is not configured.")
    url = f"{DOGE_BLOCKBOOK_BASE_URL}{path}"
    if params:
        url = f"{url}?{urlencode(params)}"
    return url


def blockbook_headers():
    if not DOGE_BLOCKBOOK_API_KEY:
        return {}
    return {DOGE_BLOCKBOOK_API_KEY_HEADER: DOGE_BLOCKBOOK_API_KEY}


def explorer_tx_url(txid):
    return DOGE_EXPLORER_TX_URL.format(txid=txid)


def output_addresses(output):
    addresses = output.get("addresses")
    if isinstance(addresses, list):
        return addresses
    if isinstance(addresses, str):
        return [addresses]
    script = output.get("scriptPubKey") or {}
    script_addresses = script.get("addresses")
    if isinstance(script_addresses, list):
        return script_addresses
    if isinstance(script_addresses, str):
        return [script_addresses]
    address_value = script.get("address")
    return [address_value] if address_value else []


class DogeLookupError(Exception):
    def __init__(self, message, *, provider="", source="", status=None):
        super().__init__(message)
        self.provider = provider
        self.source = source
        self.status = status


def provider_error_message(provider, exc):
    if isinstance(exc, DogeLookupError):
        return str(exc)
    if isinstance(exc, HTTPError):
        if exc.code == 429:
            return (
                f"{provider} is rate-limiting public requests. "
                "Set DOGE_BLOCKBOOK_BASE_URL to a dedicated Dogecoin Blockbook/indexer endpoint for production lookups."
            )
        if exc.code in {401, 403}:
            return f"{provider} refused the public request. Configure a dedicated Dogecoin indexer or provider API key."
        return f"{provider} returned HTTP {exc.code}."
    return f"{provider} lookup failed."


def doge_lookup_failure(errors, noun="Dogecoin lookup"):
    if not errors:
        return (
            f"{noun} is unavailable because no Dogecoin blockchain provider is configured. "
            "Set DOGE_BLOCKBOOK_BASE_URL to your Dogecoin Blockbook/indexer endpoint."
        )
    preferred = next((error for error in errors if "rate-limiting" in str(error).lower()), None) or errors[-1]
    return str(preferred)


def cached_provider_lookup(cache_key, fetcher, ttl=DOGE_LOOKUP_CACHE_TTL):
    now = time.time()
    cached = DOGE_LOOKUP_CACHE.get(cache_key)
    if cached and now - cached["loaded_at"] < ttl:
        return cached["payload"]
    try:
        payload = fetcher()
    except Exception:
        if cached:
            stale = dict(cached["payload"])
            stale["_stale"] = True
            return stale
        raise
    DOGE_LOOKUP_CACHE[cache_key] = {"loaded_at": now, "payload": payload}
    return payload


def blockchair_api_url(path, params=None):
    url = f"{BLOCKCHAIR_BASE_URL}{path}"
    if params:
        url = f"{url}?{urlencode(params)}"
    return url


def blockchair_address_payload(address, **params):
    throttle_server_provider("blockchair", 1.2)
    url = blockchair_api_url(f"/dashboards/address/{quote(address)}", params or None)
    payload = cached_provider_lookup(
        ("blockchair-address", address, tuple(sorted((params or {}).items()))),
        lambda: fetch_json(url),
        ttl=DOGE_LOOKUP_CACHE_TTL,
    )
    address_data = ((payload.get("data") or {}).get("addresses") or {}).get(address) or {}
    return address_data, url, payload


def blockchair_balance(address):
    address_data, url, _payload = blockchair_address_payload(address)
    summary = address_data.get("address") or {}
    balance = doge_atoms_from_chain(summary.get("balance"))
    received = doge_atoms_from_chain(summary.get("received"))
    spent = doge_atoms_from_chain(summary.get("spent"))
    unconfirmed = doge_atoms_from_chain(summary.get("balance") if summary.get("type") == "unconfirmed" else 0)
    tx_count = safe_int(summary.get("transaction_count"), 0)
    return {
        "address": address,
        "source": url,
        "provider_name": BLOCKCHAIR_PROVIDER_NAME,
        "balance_doge": doge_units(balance),
        "final_balance_doge": doge_units(balance),
        "unconfirmed_balance_doge": doge_units(unconfirmed),
        "total_received_doge": doge_units(received),
        "total_sent_doge": doge_units(spent),
        "transactions": tx_count,
        "unconfirmed_transactions": 0,
        "updated_at": utc_now_iso(),
    }


def blockchair_address_transactions(address, limit):
    address_data, url, _payload = blockchair_address_payload(
        address,
        transaction_details="true",
        limit=limit,
    )
    transactions = []
    for tx in address_data.get("transactions") or []:
        if isinstance(tx, str):
            continue
        txid = tx.get("hash")
        value = abs(doge_atoms_from_chain(tx.get("balance_change")))
        confirmations = 0 if tx.get("block_id") in (None, -1) else 1
        time_value = iso_from_epoch(tx.get("time"))
        normalized = normalize_wallet_transaction(
            txid,
            value,
            confirmations=confirmations,
            time_value=time_value,
            block_height=tx.get("block_id"),
            provider_name=BLOCKCHAIR_PROVIDER_NAME,
            source_url=url,
        )
        if normalized:
            transactions.append(normalized)
    transactions = transactions[:limit]
    summary = address_data.get("address") or {}
    return {
        "address": address,
        "source": url,
        "provider_name": BLOCKCHAIR_PROVIDER_NAME,
        "transactions": transactions,
        "limit": limit,
        "total_transactions": safe_int(summary.get("transaction_count"), len(transactions)),
        "updated_at": utc_now_iso(),
    }


def blockchair_transaction(txid):
    throttle_server_provider("blockchair", 1.2)
    url = blockchair_api_url(f"/dashboards/transaction/{quote(txid)}")
    payload = cached_provider_lookup(("blockchair-tx", txid), lambda: fetch_json(url), ttl=DOGE_LOOKUP_CACHE_TTL)
    tx_data = ((payload.get("data") or {}).get("transactions") or {}).get(txid) or {}
    transaction = tx_data.get("transaction") or {}
    normalized = {
        "hash": txid,
        "confirmations": 0 if transaction.get("block_id") in (None, -1) else safe_int(transaction.get("confirmations"), 1),
        "outputs": [],
    }
    for output in tx_data.get("outputs") or []:
        normalized["outputs"].append(
            {
                "value": output.get("value"),
                "script_type": output.get("type"),
                "scriptPubKey": {
                    "addresses": output.get("recipient") if isinstance(output.get("recipient"), list) else [output.get("recipient")] if output.get("recipient") else [],
                },
            }
        )
    return normalized, url, BLOCKCHAIR_PROVIDER_NAME


def blockchair_utxos(address, limit=50):
    throttle_server_provider("blockchair", 1.2)
    query = f"recipient({address}),is_spent(false)"
    url = blockchair_api_url("/outputs", {"q": query, "limit": limit})
    payload = cached_provider_lookup(("blockchair-utxos", address, limit), lambda: fetch_json(url), ttl=DOGE_LOOKUP_CACHE_TTL)
    utxos = []
    for item in payload.get("data") or []:
        utxos.append(
            {
                "txid": item.get("transaction_hash"),
                "vout": safe_int(item.get("index"), 0),
                "value": doge_atoms_from_chain(item.get("value")),
                "script_hex": item.get("script_hex") or "",
            }
        )
    return {
        "address": address,
        "source": url,
        "provider_name": BLOCKCHAIR_PROVIDER_NAME,
        "utxos": utxos,
        "updated_at": utc_now_iso(),
    }


def blockchair_broadcast(raw_hex):
    throttle_server_provider("blockchair", 1.2)
    url = blockchair_api_url("/push/transaction")
    payload = post_json(url, {"data": raw_hex})
    txid = ((payload.get("data") or {}).get("transaction_hash") or "").strip()
    if not txid:
        raise DogeLookupError(payload.get("context", {}).get("error") or "Blockchair rejected the transaction.", provider=BLOCKCHAIR_PROVIDER_NAME)
    return {
        "txid": txid,
        "provider_name": BLOCKCHAIR_PROVIDER_NAME,
        "source": url,
        "explorer_url": explorer_tx_url(txid),
        "updated_at": utc_now_iso(),
    }


def blockcypher_utxos(address, limit=50):
    url = f"{BLOCKCYPHER_ADDRESS_URL.format(address=quote(address))}?unspentOnly=true&limit={limit}"
    payload = cached_provider_lookup(("blockcypher-utxos", address, limit), lambda: fetch_json(url), ttl=DOGE_LOOKUP_CACHE_TTL)
    utxos = []
    for ref in payload.get("txrefs") or []:
        utxos.append(
            {
                "txid": ref.get("tx_hash"),
                "vout": safe_int(ref.get("tx_output_n"), 0),
                "value": safe_int(ref.get("value"), 0),
                "script_hex": ref.get("script") or "",
            }
        )
    return {
        "address": address,
        "source": url,
        "provider_name": BLOCKCYPHER_PROVIDER_NAME,
        "stale": bool(payload.get("_stale")),
        "utxos": utxos,
        "updated_at": utc_now_iso(),
    }


def blockcypher_broadcast(raw_hex):
    throttle_server_provider("blockcypher", 0.4)
    payload = post_json(BLOCKCYPHER_PUSH_URL, {"tx": raw_hex})
    txid = (payload.get("tx") or {}).get("hash") or ""
    if not txid:
        raise DogeLookupError(payload.get("error") or "BlockCypher rejected the transaction.", provider=BLOCKCYPHER_PROVIDER_NAME)
    return {
        "txid": txid,
        "provider_name": BLOCKCYPHER_PROVIDER_NAME,
        "source": BLOCKCYPHER_PUSH_URL,
        "explorer_url": explorer_tx_url(txid),
        "updated_at": utc_now_iso(),
    }


def blockbook_balance(address):
    url = blockbook_api_url(f"/api/v2/address/{quote(address)}")
    payload = fetch_json(url, headers=blockbook_headers())
    balance = doge_atoms_from_chain(payload.get("balance"))
    unconfirmed = doge_atoms_from_chain(payload.get("unconfirmedBalance"))
    total_received = doge_atoms_from_chain(payload.get("totalReceived"))
    total_sent = doge_atoms_from_chain(payload.get("totalSent"))
    tx_count = safe_int(payload.get("txs"), safe_int(payload.get("txApperances"), 0))
    unconfirmed_count = safe_int(payload.get("unconfirmedTxs"), 0)
    return {
        "address": address,
        "source": url,
        "provider_name": DOGE_BLOCKCHAIN_PROVIDER_NAME,
        "balance_doge": doge_units(balance),
        "final_balance_doge": doge_units(max(0, balance - unconfirmed)),
        "unconfirmed_balance_doge": doge_units(unconfirmed),
        "total_received_doge": doge_units(total_received),
        "total_sent_doge": doge_units(total_sent),
        "transactions": tx_count,
        "unconfirmed_transactions": unconfirmed_count,
        "updated_at": utc_now_iso(),
    }


def blockcypher_balance(address):
    url = BLOCKCYPHER_BALANCE_URL.format(address=quote(address))
    payload = cached_provider_lookup(("blockcypher-balance", address), lambda: fetch_json(url), ttl=DOGE_LOOKUP_CACHE_TTL)
    return {
        "address": address,
        "source": url,
        "provider_name": BLOCKCYPHER_PROVIDER_NAME,
        "stale": bool(payload.get("_stale")),
        "balance_doge": doge_units(payload.get("balance")),
        "final_balance_doge": doge_units(payload.get("final_balance")),
        "unconfirmed_balance_doge": doge_units(payload.get("unconfirmed_balance")),
        "total_received_doge": doge_units(payload.get("total_received")),
        "total_sent_doge": doge_units(payload.get("total_sent")),
        "transactions": payload.get("n_tx", 0),
        "unconfirmed_transactions": payload.get("unconfirmed_n_tx", 0),
        "updated_at": utc_now_iso(),
    }


def latest_balance(address):
    errors = []
    try:
        payload = blockchair_balance(address)
        mark_server_provider("blockchair", BLOCKCHAIR_PROVIDER_NAME, status="ready")
        return payload
    except Exception as exc:
        mark_server_provider("blockchair", BLOCKCHAIR_PROVIDER_NAME, status="error")
        SERVER_RATE_STATE.setdefault("blockchair", {})["last_error"] = provider_error_message(BLOCKCHAIR_PROVIDER_NAME, exc)
        errors.append(DogeLookupError(provider_error_message(BLOCKCHAIR_PROVIDER_NAME, exc), provider=BLOCKCHAIR_PROVIDER_NAME))
    if DOGE_BLOCKBOOK_BASE_URL:
        try:
            return blockbook_balance(address)
        except Exception as exc:
            errors.append(DogeLookupError(provider_error_message(DOGE_BLOCKCHAIN_PROVIDER_NAME, exc), provider=DOGE_BLOCKCHAIN_PROVIDER_NAME))
    if DOGE_ENABLE_BLOCKCYPHER_FALLBACK:
        try:
            payload = blockcypher_balance(address)
            mark_server_provider("blockcypher", BLOCKCYPHER_PROVIDER_NAME, status="ready")
            return payload
        except Exception as exc:
            mark_server_provider("blockcypher", BLOCKCYPHER_PROVIDER_NAME, status="error")
            SERVER_RATE_STATE.setdefault("blockcypher", {})["last_error"] = provider_error_message(BLOCKCYPHER_PROVIDER_NAME, exc)
            errors.append(DogeLookupError(provider_error_message(BLOCKCYPHER_PROVIDER_NAME, exc), provider=BLOCKCYPHER_PROVIDER_NAME))
    raise DogeLookupError(doge_lookup_failure(errors, "Balance lookup"))


def normalize_wallet_transaction(txid, value, confirmations=0, time_value="", block_height=None, spent=False, provider_name="", source_url=""):
    txid = str(txid or "").strip()
    if not re.fullmatch(r"[0-9a-fA-F]{64}", txid):
        return None
    value = int(value or 0)
    if value <= 0:
        return None
    confirmations = safe_int(confirmations, 0)
    pending = confirmations <= 0
    return {
        "txid": txid,
        "short_txid": f"{txid[:8]}...{txid[-8:]}",
        "value": value,
        "doge": doge_units(value),
        "confirmations": confirmations,
        "status": "pending" if pending else "confirmed",
        "time": time_value or "",
        "block_height": block_height,
        "spent": bool(spent),
        "source": provider_name,
        "explorer_url": explorer_tx_url(txid),
        "provider_source": source_url,
    }


def blockbook_address_transactions(address, limit):
    url = blockbook_api_url(
        f"/api/v2/address/{quote(address)}",
        {"details": "txs", "pageSize": limit},
    )
    payload = fetch_json(url, headers=blockbook_headers())
    transactions = []
    for tx in payload.get("transactions") or payload.get("txs") or []:
        txid = tx.get("txid")
        confirmations = safe_int(tx.get("confirmations"), 0)
        time_value = iso_from_epoch(tx.get("blockTime") or tx.get("time"))
        block_height = tx.get("blockHeight") or tx.get("block_height")
        incoming_atoms = 0
        for output in tx.get("vout") or tx.get("outputs") or []:
            if address in output_addresses(output):
                incoming_atoms += doge_atoms_from_chain(output.get("value"))
        normalized = normalize_wallet_transaction(
            txid,
            incoming_atoms,
            confirmations=confirmations,
            time_value=time_value,
            block_height=block_height,
            provider_name=DOGE_BLOCKCHAIN_PROVIDER_NAME,
            source_url=url,
        )
        if normalized:
            transactions.append(normalized)
    transactions = sorted(
        transactions,
        key=lambda item: (item["status"] == "pending", item.get("time") or ""),
        reverse=True,
    )[:limit]
    return {
        "address": address,
        "source": url,
        "provider_name": DOGE_BLOCKCHAIN_PROVIDER_NAME,
        "transactions": transactions,
        "limit": limit,
        "total_transactions": safe_int(payload.get("txs"), len(transactions)),
        "updated_at": utc_now_iso(),
    }


def blockcypher_address_transactions(address, limit):
    url = f"{BLOCKCYPHER_ADDRESS_URL.format(address=quote(address))}?limit={limit}"
    payload = cached_provider_lookup(("blockcypher-transactions", address, limit), lambda: fetch_json(url), ttl=DOGE_LOOKUP_CACHE_TTL)
    grouped = {}
    for ref_type in ("unconfirmed_txrefs", "txrefs"):
        for ref in payload.get(ref_type) or []:
            txid = str(ref.get("tx_hash") or ref.get("txid") or ref.get("hash") or "").strip()
            value = int(ref.get("value") or 0)
            normalized = normalize_wallet_transaction(
                txid,
                value,
                confirmations=ref.get("confirmations"),
                time_value=ref.get("confirmed") or ref.get("received") or "",
                block_height=ref.get("block_height"),
                spent=ref.get("spent"),
                provider_name=BLOCKCYPHER_PROVIDER_NAME,
                source_url=url,
            )
            if not normalized:
                continue
            existing = grouped.setdefault(txid, normalized)
            if existing is not normalized:
                existing["value"] += value
                existing["doge"] = doge_units(existing["value"])
                existing["confirmations"] = max(existing["confirmations"], normalized["confirmations"])
                if normalized["status"] == "pending":
                    existing["status"] = "pending"
                if not existing["time"]:
                    existing["time"] = normalized["time"]
                if existing["block_height"] is None:
                    existing["block_height"] = normalized["block_height"]
    transactions = sorted(
        grouped.values(),
        key=lambda item: (item["status"] == "pending", item.get("time") or ""),
        reverse=True,
    )[:limit]
    return {
        "address": address,
        "source": url,
        "provider_name": BLOCKCYPHER_PROVIDER_NAME,
        "stale": bool(payload.get("_stale")),
        "transactions": transactions,
        "limit": limit,
        "total_transactions": payload.get("n_tx", len(transactions)),
        "updated_at": utc_now_iso(),
    }


def latest_transactions(address, limit):
    errors = []
    try:
        return blockchair_address_transactions(address, limit)
    except Exception as exc:
        errors.append(DogeLookupError(provider_error_message(BLOCKCHAIR_PROVIDER_NAME, exc), provider=BLOCKCHAIR_PROVIDER_NAME))
    if DOGE_BLOCKBOOK_BASE_URL:
        try:
            return blockbook_address_transactions(address, limit)
        except Exception as exc:
            errors.append(DogeLookupError(provider_error_message(DOGE_BLOCKCHAIN_PROVIDER_NAME, exc), provider=DOGE_BLOCKCHAIN_PROVIDER_NAME))
    if DOGE_ENABLE_BLOCKCYPHER_FALLBACK:
        try:
            return blockcypher_address_transactions(address, limit)
        except Exception as exc:
            errors.append(DogeLookupError(provider_error_message(BLOCKCYPHER_PROVIDER_NAME, exc), provider=BLOCKCYPHER_PROVIDER_NAME))
    raise DogeLookupError(doge_lookup_failure(errors, "Transaction lookup"))


def blockbook_transaction(txid):
    url = blockbook_api_url(f"/api/v2/tx/{quote(txid)}")
    payload = fetch_json(url, headers=blockbook_headers())
    return payload, url, DOGE_BLOCKCHAIN_PROVIDER_NAME


def blockcypher_transaction(txid):
    url = BLOCKCYPHER_TX_URL.format(txid=quote(txid))
    payload = cached_provider_lookup(("blockcypher-tx", txid), lambda: fetch_json(url), ttl=DOGE_LOOKUP_CACHE_TTL)
    return payload, url, BLOCKCYPHER_PROVIDER_NAME


def latest_transaction(txid):
    errors = []
    try:
        return blockchair_transaction(txid)
    except Exception as exc:
        errors.append(DogeLookupError(provider_error_message(BLOCKCHAIR_PROVIDER_NAME, exc), provider=BLOCKCHAIR_PROVIDER_NAME))
    if DOGE_BLOCKBOOK_BASE_URL:
        try:
            return blockbook_transaction(txid)
        except Exception as exc:
            errors.append(DogeLookupError(provider_error_message(DOGE_BLOCKCHAIN_PROVIDER_NAME, exc), provider=DOGE_BLOCKCHAIN_PROVIDER_NAME))
    if DOGE_ENABLE_BLOCKCYPHER_FALLBACK:
        try:
            return blockcypher_transaction(txid)
        except Exception as exc:
            errors.append(DogeLookupError(provider_error_message(BLOCKCYPHER_PROVIDER_NAME, exc), provider=BLOCKCYPHER_PROVIDER_NAME))
    raise DogeLookupError(doge_lookup_failure(errors, "Transaction lookup"))


def transaction_outputs(payload):
    return payload.get("outputs") or payload.get("vout") or []


BASELINE = {
    "price": "$0.1063",
    "supply": "169.74B DOGE",
}

RAILS = [
    {
        "name": "Hosted checkout",
        "best_for": "Merchants that want compliance support and low engineering burden.",
        "examples": "BitPay, NOWPayments, payment links, invoice plugins",
    },
    {
        "name": "Merchant-controlled wallet",
        "best_for": "Small pilots, events, and direct payments where the merchant controls keys.",
        "examples": "Wallet QR, payment URI, staff reconciliation sheet",
    },
    {
        "name": "DOGE-native backend",
        "best_for": "Builders that can self-host and want direct Dogecoin infrastructure.",
        "examples": "GigaWallet, Libdogecoin, Dogebox-oriented flows",
    },
]

SEGMENTS = [
    "creator merch",
    "gaming communities",
    "food trucks and quick service",
    "restaurants and group dining",
    "personal services",
    "home services",
    "clubs and meetups",
    "collectibles",
    "delivery and logistics",
    "mobility and access",
    "digital services",
    "local events",
    "nonprofits",
    "community gardens and circular reuse",
    "gift cards and closed-loop credit",
    "school and booster clubs",
    "sports and recreation",
    "subscriptions and memberships",
    "residential communities",
    "bookstores and hobby retail",
    "vending and micro-markets",
    "corner stores and bodegas",
    "tool libraries and rentals",
    "energy and charging",
    "local media and newsletters",
]

ROADMAP = [
    ("Month 1", "Proof sprint", "Get the first 10-50 merchants live with documented DOGE offers."),
    ("Month 2", "Category clusters", "Build visible merchant groups around coffee, creators, gaming, and local food."),
    ("Month 3", "Public proof", "Publish adoption reports, setup lessons, and merchant-approved case studies."),
    ("Month 4", "Referral engine", "Turn merchant wins into referrals, office hours, and processor-specific guides."),
    ("Month 5", "Spend week", "Run a focused DOGE Spend Week with offers, creator demos, and proof posts."),
    ("Month 6", "Partner report", "Package credible data for wallets, payment processors, and ecommerce platforms."),
]

GUARDRAILS = [
    "No coordinated buying, selling, holding, or timed trading pushes.",
    "No fake receipts, fake merchant listings, wash volume, or misleading metrics.",
    "No undisclosed sponsorships, paid promotion, or hidden treasury support.",
    "No guaranteed-return language, target-price promises, or investment advice.",
    "No custody of customer or merchant funds in this product.",
    "Every public claim is either sourced, measured, or clearly labeled as a goal.",
]

PLAYBOOK_MARKET_KITS = [
    {
        "market": "Counter or pickup",
        "use_when": "The buyer is already at a register, window, table, or handoff point.",
        "first_offer": "One fixed-price item, pickup add-on, or tip line.",
        "route": "Wallet QR or hosted checkout link",
        "proof": "Order memo, amount, txid or receipt, and paid/unpaid state.",
    },
    {
        "market": "Services and deposits",
        "use_when": "The sale has a quote, booking, repair intake, or invoice number.",
        "first_offer": "A deposit, invoice line, consultation hold, or final balance.",
        "route": "Hosted invoice or payment URI",
        "proof": "Invoice number, refund rule, recipient address, and confirmation status.",
    },
    {
        "market": "Events and clubs",
        "use_when": "A group collects small payments at a table, meetup, or booth.",
        "first_offer": "Entry, raffle, dues, snack table, booth bundle, or seat reservation.",
        "route": "Shared table QR with a required memo",
        "proof": "Payer count, category, DOGE total, treasurer or volunteer approval.",
    },
    {
        "market": "Donations",
        "use_when": "A campaign can report aggregate impact without exposing donors.",
        "first_offer": "Impact milestone, match day, sponsor thank-you, or tip jar.",
        "route": "Dedicated donation wallet or processor link",
        "proof": "Aggregate DOGE, contribution count, sponsor disclosure, impact unit.",
    },
    {
        "market": "Stored value",
        "use_when": "The merchant is not ready to rewire the full checkout flow.",
        "first_offer": "Gift card, prepaid tab, member balance, or service credit.",
        "route": "Hosted checkout link or wallet QR",
        "proof": "Credit issued, redemption rule, refund rule, and ledger row.",
    },
    {
        "market": "Repeat customers",
        "use_when": "The business already has loyalty, subscriptions, classes, or memberships.",
        "first_offer": "Member day, refill window, renewal, bonus stamp, or class seat.",
        "route": "Hosted link, renewal invoice, or wallet QR",
        "proof": "Repeat buyer count, account credit, redemption, and staff approval.",
    },
]

METRICS = [
    "active DOGE-accepting merchants",
    "verified DOGE transactions",
    "estimated DOGE payment volume",
    "repeat payer rate",
    "merchant retention after 30 and 90 days",
    "public proof artifacts",
    "payment processor conversations and pilots",
]

ROLE_PATHS = [
    {
        "role": "I sell things",
        "title": "Take DOGE at my counter",
        "summary": "Quote in USD, show a QR, verify the buyer paid, and hand off the goods with a local receipt.",
        "href": "/pos/",
        "action": "Open POS",
    },
    {
        "role": "I build sites",
        "title": "Add DOGE to my page",
        "summary": "Browse the snippet marketplace, preview a badge or donate button, and copy one self-contained block.",
        "href": "/merchant-kit/",
        "action": "Browse tools",
    },
    {
        "role": "I hold DOGE",
        "title": "Set up my wallet",
        "summary": "Generate a new Dogecoin wallet or paste an address right inside the POS Terminal — keys stay in your browser.",
        "href": "/pos/",
        "action": "Open POS setup",
    },
]

DASHBOARD_STEPS = [
    {
        "kicker": "Step 1",
        "title": "Save your receive address",
        "summary": "Generate a wallet or paste your Dogecoin address in the POS Terminal so every tool knows where payments land.",
        "href": "/pos/",
        "action": "Set wallet in POS",
    },
    {
        "kicker": "Step 2",
        "title": "Run one real checkout",
        "summary": "Use the POS Terminal to quote USD, show a QR, and walk through verify-and-record like a normal sale.",
        "href": "/pos/",
        "action": "Take payment",
    },
    {
        "kicker": "Step 3",
        "title": "Copy a snippet you need",
        "summary": "Pick a QR, badge, receipt, or validation tool from the marketplace and paste it where buyers will see it.",
        "href": "/merchant-kit/",
        "action": "Browse snippets",
    },
    {
        "kicker": "Step 4",
        "title": "Understand why it helps",
        "summary": "Read the playbook for fast payments, low fees, and no chargebacks — then share one success with someone else.",
        "href": "/playbook/",
        "action": "Read playbook",
    },
]

ADOPTION_MOVES = [
    {
        "title": "Build proof clusters",
        "summary": "Recruit the next merchant from the same block, event, platform, or buyer group so each verified checkout lowers the next setup cost.",
    },
    {
        "title": "Run office-hour onboarding",
        "summary": "Use one weekly setup window to help merchants choose a route, test a small payment, and assign proof review before launch.",
    },
    {
        "title": "Publish category recaps",
        "summary": "Package proof by coffee, events, services, access passes, and donations so new merchants see a familiar operating model.",
    },
    {
        "title": "Hand processors real asks",
        "summary": "Bring verified route data, failed attempts, fee notes, and merchant retention signals to wallets, processors, and ecommerce plugins.",
    },
]

ADOPTION_LANES = [
    {
        "moment": "Morning routine",
        "title": "Make one common purchase DOGE-ready",
        "summary": "Start with coffee, breakfast, lunch pickup, or a small counter add-on where the buyer already expects a fast checkout.",
        "kits": "Coffee Window QR, Pickup Add-on, Workplace Lunch Pool",
        "href": "/playbook/#quick-commerce-kits",
    },
    {
        "moment": "Neighborhood errands",
        "title": "Attach DOGE to practical local tasks",
        "summary": "Use laundromats, repair desks, delivery runs, tool rentals, appointment deposits, and errand boards to turn DOGE into visible service payments.",
        "kits": "Laundry Reload, Neighborhood Errand Board, Home Service Callout",
        "href": "/playbook/#quick-commerce-kits",
    },
    {
        "moment": "Household services",
        "title": "Make everyday home help DOGE-ready",
        "summary": "Use fixed callout deposits, yard-work add-ons, mobile repair benches, and appointment holds where the service quote already needs a clear confirmation step.",
        "kits": "Home Service Callout, Mobile Repair Bench, Appointment Deposit",
        "href": "/playbook/#quick-commerce-kits",
    },
    {
        "moment": "Group spending",
        "title": "Put DOGE into shared tabs and stored value",
        "summary": "Use table splits, gift cards, and closed-loop store credit so buyers can spend DOGE without changing every register flow at once.",
        "kits": "Restaurant Table Split, Gift Card Starter, Neighborhood Loyalty Pass",
        "href": "/playbook/#quick-commerce-kits",
    },
    {
        "moment": "Community tables",
        "title": "Use events people already attend",
        "summary": "Give clubs, schools, sports teams, hobby shops, and market organizers one recurring DOGE payment point.",
        "kits": "Club Dues Table, Block Sale Price Tag, School Fundraiser Table",
        "href": "/playbook/#quick-commerce-kits",
    },
    {
        "moment": "Community care",
        "title": "Fund visible support work with DOGE",
        "summary": "Use meal tickets, pantry restocks, library book sales, and senior-center meals where organizers can report aggregate impact without exposing private recipients.",
        "kits": "Senior Center Meal Ticket, Community Fridge Restock, Library Friends Book Sale",
        "href": "/playbook/#quick-commerce-kits",
    },
    {
        "moment": "Shared spaces",
        "title": "Put DOGE inside places people revisit",
        "summary": "Add DOGE to amenity passes, parking, charging, coworking drop-ins, print stations, and class seats so repeat use can be measured.",
        "kits": "Apartment Amenity Pass, Print & Ship Desk, Community Wi-Fi Pass",
        "href": "/playbook/#quick-commerce-kits",
    },
    {
        "moment": "Repair and reuse",
        "title": "Make practical fixes DOGE-funded",
        "summary": "Use repair cafes, bike co-ops, maker benches, tool libraries, and hardware partners where small parts and deposits are already documented.",
        "kits": "Repair Cafe Parts Jar, Tool Library Rental, Mobile Repair Bench",
        "href": "/playbook/#quick-commerce-kits",
    },
    {
        "moment": "Access and mobility",
        "title": "Make entry, passes, and local movement DOGE-ready",
        "summary": "Start with private shuttles, day passes, desk drops, parking, and venue access where fixed-price confirmation is easy.",
        "kits": "Community Shuttle Pass, Parking Day Pass, Coworking Day Desk",
        "href": "/playbook/#quick-commerce-kits",
    },
    {
        "moment": "Unattended checkout",
        "title": "Make self-serve moments DOGE-visible",
        "summary": "Use lockers, micro-markets, snack shelves, and kiosk corners where fixed-price QR checkout is simple to test.",
        "kits": "Vending Locker QR, Fixed-price Kiosk QR, Campus Print Pass",
        "href": "/playbook/#quick-commerce-kits",
    },
    {
        "moment": "Creator proof",
        "title": "Turn fandom into repeat checkout evidence",
        "summary": "Creators can run drops, tips, digital goods, memberships, and fan perks with opt-in proof that helps recruit adjacent merchants.",
        "kits": "Creator Drop, Local Newsletter Membership, Service Tip Rail",
        "href": "/playbook/#quick-commerce-kits",
    },
]

KIT_PRESETS = [
    {
        "label": "Counter sale",
        "summary": "Coffee, pickup add-ons, staples, and fast fixed-price items.",
        "kit": "coffee-window",
        "audience": "merchant",
        "vertical": "food trucks and quick service",
        "rail": "wallet",
        "speed": "same day",
        "query": "coffee",
    },
    {
        "label": "Event table",
        "summary": "Booths, club dues, vendor rows, concessions, and classes.",
        "kit": "event-booth",
        "audience": "merchant",
        "vertical": "local events",
        "rail": "wallet",
        "speed": "same day",
        "query": "event",
    },
    {
        "label": "Service invoice",
        "summary": "Freelance work, repairs, deposits, tips, and appointments.",
        "kit": "service-invoice",
        "audience": "merchant",
        "vertical": "digital services",
        "rail": "hosted",
        "speed": "1 day",
        "query": "invoice",
    },
    {
        "label": "Stored value",
        "summary": "Gift cards, loyalty passes, memberships, and repeat visits.",
        "kit": "gift-card-starter",
        "audience": "merchant",
        "vertical": "gift cards and closed-loop credit",
        "rail": "hosted",
        "speed": "1 day",
        "query": "gift",
    },
    {
        "label": "Community care",
        "summary": "Meal tickets, fridge restocks, fundraisers, and public-good drives.",
        "kit": "community-fridge-restock",
        "audience": "nonprofit",
        "vertical": "nonprofits",
        "rail": "wallet",
        "speed": "same day",
        "query": "community",
    },
    {
        "label": "Self-serve access",
        "summary": "Lockers, print stations, parking, Wi-Fi, charging, and day passes.",
        "kit": "vending-locker-qr",
        "audience": "merchant",
        "vertical": "vending and micro-markets",
        "rail": "wallet",
        "speed": "same day",
        "query": "vending",
    },
    {
        "label": "Neighborhood errands",
        "summary": "Laundry, pet care, deposits, local tasks, and service add-ons.",
        "kit": "neighborhood-errand-board",
        "audience": "merchant",
        "vertical": "personal services",
        "rail": "hosted",
        "speed": "1 day",
        "query": "errand",
    },
    {
        "label": "Repair and reuse",
        "summary": "Repair cafes, tools, parts jars, bike fixes, and maker benches.",
        "kit": "repair-cafe-parts-jar",
        "audience": "nonprofit",
        "vertical": "tool libraries and rentals",
        "rail": "wallet",
        "speed": "same day",
        "query": "repair",
    },
    {
        "label": "Home services",
        "summary": "Callout deposits, yard work, appliance fixes, and house visits.",
        "kit": "home-service-callout",
        "audience": "merchant",
        "vertical": "home services",
        "rail": "hosted",
        "speed": "1 day",
        "query": "home",
    },
    {
        "label": "Block sale",
        "summary": "Yard sales, flea tables, swap meets, and porch pickup tags.",
        "kit": "block-sale-price-tag",
        "audience": "merchant",
        "vertical": "local events",
        "rail": "wallet",
        "speed": "same day",
        "query": "block sale",
    },
    {
        "label": "Desk services",
        "summary": "Print, ship, copy, notary add-ons, and small front-desk fees.",
        "kit": "print-ship-desk",
        "audience": "merchant",
        "vertical": "digital services",
        "rail": "hosted",
        "speed": "same day",
        "query": "print",
    },
]

KIT_SHORTCUTS = [
    {
        "label": "A counter is open now",
        "action": "Launch a wallet QR",
        "summary": "Use one same-day QR for a fixed-price item and a cashier confirmation rule.",
        "kit": "coffee-window",
        "audience": "merchant",
        "vertical": "food trucks and quick service",
        "rail": "wallet",
        "speed": "same day",
        "query": "coffee",
        "amount": "8.50",
        "memo": "DOGE counter sale",
    },
    {
        "label": "I need a deposit",
        "action": "Use a checkout link",
        "summary": "Collect a service hold, appointment fee, or invoice deposit without changing every job.",
        "kit": "home-service-callout",
        "audience": "merchant",
        "vertical": "home services",
        "rail": "hosted",
        "speed": "1 day",
        "query": "home service deposit",
        "amount": "25.00",
        "memo": "DOGE service deposit",
    },
    {
        "label": "A shared space has passes",
        "action": "Sell one access pass",
        "summary": "Put DOGE into a building, desk, parking, Wi-Fi, or amenity moment people revisit.",
        "kit": "apartment-amenity-pass",
        "audience": "merchant",
        "vertical": "residential communities",
        "rail": "hosted",
        "speed": "1 day",
        "query": "amenity pass",
        "amount": "12.00",
        "memo": "DOGE access pass",
    },
    {
        "label": "A community table is live",
        "action": "Fund one visible need",
        "summary": "Use DOGE for a restock, meal ticket, dues table, or fundraiser with aggregate proof.",
        "kit": "community-fridge-restock",
        "audience": "nonprofit",
        "vertical": "nonprofits",
        "rail": "wallet",
        "speed": "same day",
        "query": "community restock",
        "amount": "10.00",
        "memo": "DOGE community support",
    },
    {
        "label": "A public routine repeats",
        "action": "Pilot a micro-stand",
        "summary": "Attach DOGE to a stop, garden, parts drawer, or arts table people already pass.",
        "kit": "transit-stop-micro-stand",
        "audience": "merchant",
        "vertical": "mobility and access",
        "rail": "wallet",
        "speed": "same day",
        "query": "transit stand",
        "amount": "4.00",
        "memo": "DOGE public routine sale",
    },
]

COMMERCE_PACKS = [
    {
        "key": "main-street-first-mile",
        "name": "Main Street First Mile",
        "program": "Daily errands",
        "summary": "Put DOGE into a normal walkable errand loop: coffee, staples, desk services, and local delivery add-ons.",
        "best_for": "Main-street associations, shopping strips, neighborhood promoters, and city-center merchants.",
        "kit_keys": ["coffee-window", "corner-store-staple", "print-ship-desk", "neighborhood-delivery-add-on"],
        "kit_names": "Coffee Window QR, Corner Store Staple, Print & Ship Desk, Neighborhood Delivery Add-on",
        "first_kit": "coffee-window",
        "launch_window": "One block, one week, four fixed-price DOGE offers.",
        "first_step": "Start with the counter item that can be fulfilled immediately and validated by one staff rule.",
        "relay": "Use the first proof recap to recruit the next adjacent storefront into the same errand loop.",
        "proof_metric": "Completed DOGE orders by venue, failed scans, repeat buyers, and merchant approval.",
    },
    {
        "key": "event-weekend-pack",
        "name": "Event Weekend Pack",
        "program": "Booths and clubs",
        "summary": "Run DOGE at places that already have a table, ticket, volunteer, or fixed-price concession moment.",
        "best_for": "Meetups, sports clubs, vendor rows, conventions, school groups, and recurring local events.",
        "kit_keys": ["event-booth", "vendor-row-pass", "sports-concession-window", "club-dues-table", "festival-wristband-topup"],
        "kit_names": "Local Event Booth, Vendor Row Pass, Sports Concession Window, Club Dues Table, Festival Wristband Top-up",
        "first_kit": "event-booth",
        "launch_window": "One event day with one QR route and one volunteer closeout sheet.",
        "first_step": "Give every volunteer the same confirmation rule before doors open.",
        "relay": "Turn the event recap into the sponsor and organizer ask for the next event.",
        "proof_metric": "Paid entries, booth sales, concession count, volunteer confirmation, and failed attempts.",
    },
    {
        "key": "residential-life-pack",
        "name": "Residential Life Pack",
        "program": "Shared spaces",
        "summary": "Make DOGE useful in buildings and campuses through amenity passes, laundry, Wi-Fi, parking, and welcome bundles.",
        "best_for": "Apartment communities, campus housing, coworking spaces, property managers, and relocation desks.",
        "kit_keys": ["apartment-amenity-pass", "laundry-reload", "community-wifi-pass", "parking-day-pass", "neighborhood-welcome-pack"],
        "kit_names": "Apartment Amenity Pass, Laundry Reload, Community Wi-Fi Pass, Parking Day Pass, Neighborhood Welcome Pack",
        "first_kit": "apartment-amenity-pass",
        "launch_window": "One shared-space offer per week with aggregate reporting.",
        "first_step": "Choose the pass or reload that already has a front desk, portal, or posted access rule.",
        "relay": "Use redemption proof to recruit one more building, property group, or nearby merchant.",
        "proof_metric": "Passes sold, redemptions, repeat residents, privacy status, and partner confirmation.",
    },
    {
        "key": "repair-reuse-pack",
        "name": "Repair and Reuse Pack",
        "program": "Fix-it economy",
        "summary": "Attach DOGE to practical repair, rental, parts, and resale moments where small payments are already documented.",
        "best_for": "Repair cafes, bike co-ops, maker spaces, tool libraries, hardware partners, and resale groups.",
        "kit_keys": ["repair-cafe-parts-jar", "tool-library-rental", "mobile-repair-bench", "block-sale-price-tag"],
        "kit_names": "Repair Cafe Parts Jar, Tool Library Rental, Mobile Repair Bench, Block Sale Price Tag",
        "first_kit": "repair-cafe-parts-jar",
        "launch_window": "One repair day, one parts jar, and one reusable closeout note.",
        "first_step": "Start where a volunteer can confirm the item, part, or rental before handoff.",
        "relay": "Use repaired-item proof to ask a hardware sponsor or another maker space to reuse the kit.",
        "proof_metric": "Items repaired, parts funded, rentals paid, failed scans, and volunteer approval.",
    },
    {
        "key": "public-routines-pack",
        "name": "Public Routines Pack",
        "program": "Daily civic life",
        "summary": "Put DOGE into small repeated public moments: stops, gardens, hardware drawers, and arts tables.",
        "best_for": "Neighborhood associations, transit-adjacent vendors, gardens, repair sponsors, local arts groups, and campus operators.",
        "kit_keys": ["transit-stop-micro-stand", "community-garden-credit", "hardware-parts-drawer", "local-arts-tip-window"],
        "kit_names": "Transit Stop Micro-Stand, Community Garden Credit, Hardware Parts Drawer, Local Arts Tip Window",
        "first_kit": "transit-stop-micro-stand",
        "launch_window": "One repeated public routine, one fixed-price DOGE offer, and one weekly proof recap.",
        "first_step": "Start where people already pause: a queue, garden table, parts counter, or local show.",
        "relay": "Use proof from the repeated routine to recruit the next public-facing operator nearby.",
        "proof_metric": "Completed micro-payments, failed scans, repeat windows, operator approval, and privacy status.",
    },
    {
        "key": "community-care-pack",
        "name": "Community Care Pack",
        "program": "Public-good drives",
        "summary": "Use DOGE for visible support work while keeping recipient privacy out of every public proof artifact.",
        "best_for": "Mutual-aid teams, senior centers, food drives, service clubs, library groups, and local sponsors.",
        "kit_keys": ["community-fridge-restock", "senior-center-meal-ticket", "meal-train-voucher", "nonprofit-tip-jar", "library-friends-book-sale"],
        "kit_names": "Community Fridge Restock, Senior Center Meal Ticket, Meal Train Voucher, Nonprofit Tip Jar, Library Friends Book Sale",
        "first_kit": "community-fridge-restock",
        "launch_window": "One impact category, one dedicated route, and one aggregate weekly update.",
        "first_step": "Name the concrete impact unit and confirm who approves public totals.",
        "relay": "Use aggregate impact proof to recruit a grocery partner, sponsor, or neighboring group.",
        "proof_metric": "Contribution count, DOGE total, impact unit, sponsor disclosure, and recipient privacy status.",
    },
    {
        "key": "creator-to-local-pack",
        "name": "Creator to Local Pack",
        "program": "Audience bridges",
        "summary": "Move DOGE from online fandom into local purchases through creator drops, newsletters, shops, and drop-in passes.",
        "best_for": "Creators, local newsletters, fan groups, bookstores, gyms, hobby shops, and audience-led communities.",
        "kit_keys": ["creator-drop", "local-newsletter-membership", "bookstore-trade-night", "gym-drop-in-pass"],
        "kit_names": "Creator Drop, Local Newsletter Membership, Bookstore Trade Night, Gym Drop-in Pass",
        "first_kit": "creator-drop",
        "launch_window": "One creator post, one local offer, and one opt-in proof recap.",
        "first_step": "Start with the product or perk the audience already understands, then route proof to the local partner.",
        "relay": "Use opt-in proof to recruit the next creator or venue with the same audience overlap.",
        "proof_metric": "Orders, opt-in proof, local redemptions, repeat buyers, and merchant approval.",
    },
]

QUICK_COMMERCE_KITS = [
    {
        "key": "coffee-window",
        "name": "Coffee Window QR",
        "best_for": "Counters, food trucks, pop-ups, and other quick-service moments.",
        "time": "Same day",
        "route": "Merchant wallet QR or hosted checkout link",
        "offer": "DOGE breakfast combo or 10% DOGE pickup window",
        "placement": "Counter sign, menu line, receipt footer, and staff point-of-sale note.",
        "buyer_prompt": "Use DOGE for one named counter item while the line is already moving.",
        "merchant_setup": "Print one QR, pin the USD price beside it, and keep a staff confirmation note at the register.",
        "repeat_hook": "Run the same DOGE window every Friday morning until repeat buyers appear.",
        "adoption_channel": "Neighboring counters, food trucks, and pickup windows.",
        "staff_script": "DOGE is live for this item. Scan the QR, show the confirmation, and we will mark the receipt as paid in DOGE.",
        "proof_prompt": "Capture the route, DOGE amount, USD value, redacted receipt, and cashier confirmation.",
        "next_step": "Use the recap to invite the next shop on the block into the same window.",
        "audience": "merchant",
        "rail": "wallet",
        "vertical": "food trucks and quick service",
    },
    {
        "key": "creator-drop",
        "name": "Creator Drop",
        "best_for": "Merch, paid communities, art drops, digital downloads, and commission slots.",
        "time": "1-2 days",
        "route": "Hosted checkout or merchant wallet QR",
        "offer": "Limited DOGE-only product, tip goal, or early-access perk",
        "placement": "Product page, pinned post, stream overlay, and order confirmation note.",
        "buyer_prompt": "Offer a scarce product, tip goal, or early-access perk payable in DOGE.",
        "merchant_setup": "Put the checkout link in the product post and repeat the same route in the confirmation note.",
        "repeat_hook": "Turn the best-performing DOGE drop into a monthly creator perk.",
        "adoption_channel": "Adjacent creators, fan communities, and merch platforms.",
        "staff_script": "This drop can be paid in DOGE. Use the checkout link, then keep your confirmation for the proof recap if you opt in.",
        "proof_prompt": "Record opt-in buyer handle, product, route, amount, and publish permission.",
        "next_step": "Recruit two adjacent creators with the proof post and a reusable drop checklist.",
        "audience": "creator",
        "rail": "hosted",
        "vertical": "creator merch",
    },
    {
        "key": "event-booth",
        "name": "Local Event Booth",
        "best_for": "Farmers markets, car meets, gaming nights, conferences, and club tables.",
        "time": "Same day",
        "route": "Merchant wallet QR with a printed fallback payment link",
        "offer": "DOGE event menu item, raffle entry, booth bundle, or table fee",
        "placement": "Table tent, volunteer phone lock screen, event map, and recap post.",
        "buyer_prompt": "Let attendees use DOGE for one booth item, raffle entry, table fee, or event bundle.",
        "merchant_setup": "Give each volunteer the same QR and a one-line confirmation rule before doors open.",
        "repeat_hook": "Repeat the booth kit at the next meetup and compare completion counts.",
        "adoption_channel": "Sponsors, club organizers, vendor rows, and recurring local events.",
        "staff_script": "DOGE checkout is available at this booth today. Scan here, confirm the amount, then show the payment screen.",
        "proof_prompt": "Count completed orders, save one redacted example, and note any failed checkout attempts.",
        "next_step": "Turn the event recap into a sponsor pitch for the next local gathering.",
        "audience": "merchant",
        "rail": "wallet",
        "vertical": "local events",
    },
    {
        "key": "nonprofit-tip-jar",
        "name": "Nonprofit Tip Jar",
        "best_for": "Community drives, food banks, mutual-aid funds, and public service campaigns.",
        "time": "1 day",
        "route": "Dedicated donation wallet or processor link",
        "offer": "DOGE donation match, impact milestone, or sponsor thank-you wall",
        "placement": "Donation page, lobby sign, volunteer script, and weekly impact update.",
        "buyer_prompt": "Invite DOGE holders to fund one public impact milestone instead of a vague donation ask.",
        "merchant_setup": "Use a dedicated campaign route and publish aggregate totals on a predictable cadence.",
        "repeat_hook": "Repeat the DOGE window around monthly drives or sponsor-match days.",
        "adoption_channel": "Local sponsors, community drives, service clubs, and public-good campaigns.",
        "staff_script": "DOGE donations are accepted for this campaign. The public report will show totals and impact, not donor private details.",
        "proof_prompt": "Track aggregate donation count, DOGE total, USD estimate, sponsor disclosure, and impact note.",
        "next_step": "Ask local sponsors to match a future DOGE donation window.",
        "audience": "nonprofit",
        "rail": "hosted",
        "vertical": "nonprofits",
    },
    {
        "key": "service-invoice",
        "name": "Service Invoice",
        "best_for": "Freelancers, repair shops, consultants, tutors, and local services.",
        "time": "1 day",
        "route": "Hosted invoice or merchant wallet payment URI",
        "offer": "Pay one invoice in DOGE with a clear quote and settlement policy",
        "placement": "Invoice footer, booking confirmation, checkout email, and client FAQ.",
        "buyer_prompt": "Give one client a clearly quoted DOGE payment option for a normal service invoice.",
        "merchant_setup": "Add the payment URI or hosted invoice to the estimate, booking email, and final invoice.",
        "repeat_hook": "Offer DOGE on repeat maintenance, retainers, lessons, or recurring service calls.",
        "adoption_channel": "Freelancer groups, local service directories, and repair categories.",
        "staff_script": "This invoice can be paid in DOGE using the quoted amount. We confirm receipt before marking the job paid.",
        "proof_prompt": "Save invoice number, route, confirmation status, fee buffer, and redacted client approval.",
        "next_step": "Build a service-category proof post for similar local operators.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "digital services",
    },
    {
        "key": "pickup-addon",
        "name": "Pickup Add-on",
        "best_for": "Restaurants, retail pickup desks, delivery windows, and curbside orders.",
        "time": "Same day",
        "route": "Hosted checkout link or QR at pickup",
        "offer": "DOGE-paid add-on: dessert, sticker, upgrade, tip, or small accessory",
        "placement": "Pickup shelf sign, order-ready SMS, counter QR, and staff handoff card.",
        "buyer_prompt": "Offer a small DOGE-paid add-on at the exact moment the buyer picks up an order.",
        "merchant_setup": "Put the QR at handoff and keep the add-on low enough for quick confirmation.",
        "repeat_hook": "Rotate the DOGE add-on weekly and track ticket lift.",
        "adoption_channel": "Retail pickup desks, restaurants, delivery counters, and curbside windows.",
        "staff_script": "You can add this small item with DOGE at pickup. Scan the QR and show the confirmation before we hand it over.",
        "proof_prompt": "Track add-on count, average ticket lift, route, and one redacted receipt example.",
        "next_step": "Pitch the add-on kit to nearby stores that already run pickup orders.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "food trucks and quick service",
    },
    {
        "key": "restaurant-table-split",
        "name": "Restaurant Table Split",
        "best_for": "Restaurants, food halls, brewery nights, trivia groups, and meetup dinners.",
        "time": "Same day",
        "route": "Hosted checkout link or register-side wallet QR",
        "offer": "DOGE table split, dessert add-on, tip pool, or group-tab closeout",
        "placement": "Server book, table tent, receipt footer, group chat, and payment stand.",
        "buyer_prompt": "Let one table close a familiar shared tab with DOGE after the meal is already priced.",
        "merchant_setup": "Create one QR or checkout link for the table split SKU, show the USD reference, and tell servers how to verify the memo or receipt.",
        "repeat_hook": "Run it on one weekly community night and measure returning groups.",
        "adoption_channel": "Restaurants, bars, food halls, trivia nights, and meetup dinners.",
        "staff_script": "DOGE can close this table split. Scan the link or QR, include the table memo, and show the confirmation before closeout.",
        "proof_prompt": "Track table count, DOGE total, USD value, memo quality, tip handling, and one redacted closeout record.",
        "next_step": "Use the table-split recap to invite another group-night venue into the same offer.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "restaurants and group dining",
    },
    {
        "key": "gift-card-starter",
        "name": "Gift Card Starter",
        "best_for": "Retailers, cafes, salons, bookstores, creators, and service shops not ready to rewire every checkout.",
        "time": "1 day",
        "route": "Hosted checkout link or merchant wallet QR for stored-value credit",
        "offer": "DOGE-paid store credit, gift card, prepaid tab, or member balance",
        "placement": "Gift card page, counter sign, receipt footer, loyalty email, and staff FAQ.",
        "buyer_prompt": "Let buyers use DOGE to buy store credit first, then redeem through the merchant's normal checkout.",
        "merchant_setup": "Create one stored-value product, write the redemption and refund rule, and reconcile DOGE purchases against the gift-card ledger.",
        "repeat_hook": "Feature one DOGE gift-card window each month and measure redemptions, not just purchases.",
        "adoption_channel": "Retail groups, creator shops, cafes, salons, hobby stores, and gift-card directories.",
        "staff_script": "DOGE can buy this store credit. Confirm the payment route, issue the credit, and redeem it like any other gift card.",
        "proof_prompt": "Track credit issued, redemption count, DOGE total, USD value, refund policy, and merchant approval.",
        "next_step": "Use redemption proof to recruit merchants that want DOGE demand without full POS changes.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "gift cards and closed-loop credit",
        "proof_route": "gift card route",
    },
    {
        "key": "loyalty-pass",
        "name": "Neighborhood Loyalty Pass",
        "best_for": "Cafes, gyms, salons, bookstores, hobby shops, and retailers that already run repeat-visit perks.",
        "time": "2 days",
        "route": "Hosted checkout link or merchant wallet QR",
        "offer": "DOGE member day, bonus stamp, fifth-visit perk, or small loyalty upgrade",
        "placement": "Punch card, member email, register display, receipt footer, and loyalty-program page.",
        "buyer_prompt": "Ask regulars to use DOGE for a familiar loyalty reward instead of a new behavior.",
        "merchant_setup": "Attach the DOGE route to one existing loyalty mechanic and keep the reward simple to redeem.",
        "repeat_hook": "Run a recurring DOGE member day and measure how many buyers return within 30 days.",
        "adoption_channel": "Neighboring loyalty programs, main-street groups, and local business associations.",
        "staff_script": "DOGE counts for this loyalty perk today. Scan the QR, show the confirmation, and we will apply the stamp or upgrade.",
        "proof_prompt": "Track DOGE loyalty redemptions, repeat buyers, reward cost, and one redacted receipt example.",
        "next_step": "Use repeat-buyer proof to recruit nearby shops that already understand loyalty programs.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "personal services",
    },
    {
        "key": "subscription-refill-window",
        "name": "Subscription Refill Window",
        "best_for": "Coffee bean clubs, meal prep, paid communities, newsletters, gym packs, and monthly service credits.",
        "time": "2 days",
        "route": "Hosted invoice, renewal link, or merchant wallet payment URI",
        "offer": "DOGE renewal, refill credit, bonus month, member add-on, or prepaid service pack",
        "placement": "Renewal email, account page, member chat, invoice footer, and retention campaign.",
        "buyer_prompt": "Let existing customers renew or refill something they already buy instead of asking them to try a new product.",
        "merchant_setup": "Attach one DOGE route to the renewal or refill SKU and define how credits post to the customer account.",
        "repeat_hook": "Repeat the DOGE refill window each billing cycle and track retained members.",
        "adoption_channel": "Subscription businesses, local clubs, creators, gyms, meal services, and recurring service operators.",
        "staff_script": "DOGE can renew or refill this account today. Use the posted link, include the account memo, and keep the confirmation for support.",
        "proof_prompt": "Track renewals, repeat buyers, DOGE total, USD value, account-credit status, and opt-in proof.",
        "next_step": "Use retention proof to invite another recurring-revenue operator into a DOGE refill window.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "subscriptions and memberships",
    },
    {
        "key": "tip-rail",
        "name": "Service Tip Rail",
        "best_for": "Barbers, salons, tattoo artists, repair techs, delivery crews, streamers, and appointment services.",
        "time": "Same day",
        "route": "Merchant wallet QR",
        "offer": "DOGE tip jar, service add-on, appointment thank-you, or tip-match window",
        "placement": "Mirror sign, booking confirmation, receipt footer, tip stand, and technician handoff card.",
        "buyer_prompt": "Let customers tip in DOGE where tipping already happens.",
        "merchant_setup": "Use a dedicated tip address, label it clearly, and separate tips from sale revenue in the ledger.",
        "repeat_hook": "Keep the QR live for a month and publish aggregate tip counts with worker permission.",
        "adoption_channel": "Personal-service operators, creator communities, and local appointment businesses.",
        "staff_script": "DOGE tips are optional. Scan this QR, enter the amount you want to send, and show the confirmation if you want it recorded.",
        "proof_prompt": "Track aggregate tip count, DOGE total, worker permission, and whether tips were retained or converted.",
        "next_step": "Turn aggregate tip data into a simple pitch for other service workers.",
        "audience": "creator",
        "rail": "wallet",
        "vertical": "personal services",
    },
    {
        "key": "club-dues-table",
        "name": "Club Dues Table",
        "best_for": "Meetups, campus clubs, sports leagues, hobby groups, gaming nights, and recurring community tables.",
        "time": "Same day",
        "route": "Merchant wallet QR or hosted payment link",
        "offer": "DOGE dues, snack table, tournament entry, raffle ticket, or fundraiser pass",
        "placement": "Sign-in desk, event page, group chat, table tent, and recap post.",
        "buyer_prompt": "Let members use DOGE for the small recurring payments they already make to participate.",
        "merchant_setup": "Put one QR at sign-in, name the treasurer or owner, and reconcile after the meeting.",
        "repeat_hook": "Run the same DOGE dues table at each meetup and publish monthly aggregate totals.",
        "adoption_channel": "Club networks, campus orgs, league organizers, and recurring meetup hosts.",
        "staff_script": "DOGE is accepted for this table today. Scan the QR, include the memo, and show confirmation before we mark you paid.",
        "proof_prompt": "Track payer count, DOGE total, dues category, treasurer confirmation, and any failed attempts.",
        "next_step": "Use the recurring table proof to recruit adjacent clubs and event hosts.",
        "audience": "nonprofit",
        "rail": "wallet",
        "vertical": "clubs and meetups",
    },
    {
        "key": "workplace-lunch-pool",
        "name": "Workplace Lunch Pool",
        "best_for": "Office lunches, coworking spaces, campus teams, break rooms, and small crew orders.",
        "time": "Same day",
        "route": "Hosted checkout link or merchant wallet QR",
        "offer": "DOGE-paid lunch pool, snack shelf refill, or group-order add-on",
        "placement": "Team chat, break-room sign, lunch order form, receipt footer, and pickup table.",
        "buyer_prompt": "Let one familiar group pay DOGE for a lunch or snack moment they already repeat.",
        "merchant_setup": "Create one checkout link or QR for the group order and name the order owner before collecting payments.",
        "repeat_hook": "Run the DOGE lunch pool weekly and measure repeat buyers inside the same workplace.",
        "adoption_channel": "Coworking spaces, offices, campus departments, and recurring team events.",
        "staff_script": "This group order accepts DOGE today. Use the link or QR, include the lunch memo, and show confirmation before pickup.",
        "proof_prompt": "Track payer count, DOGE total, group-order owner confirmation, and one redacted order summary.",
        "next_step": "Use the repeat lunch data to recruit another team or nearby office.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "clubs and meetups",
    },
    {
        "key": "appointment-deposit",
        "name": "Appointment Deposit",
        "best_for": "Barbers, salons, tutors, repair desks, trainers, and appointment-based operators.",
        "time": "1 day",
        "route": "Hosted invoice or merchant wallet payment URI",
        "offer": "DOGE booking deposit, class reservation, repair intake fee, or consultation hold",
        "placement": "Booking page, confirmation text, front-desk QR, intake form, and reminder email.",
        "buyer_prompt": "Use DOGE for the small deposit that already reserves the appointment.",
        "merchant_setup": "Attach the payment URI or invoice link to the appointment confirmation and define refund timing before launch.",
        "repeat_hook": "Keep DOGE deposits open for one service line and compare no-show rate against normal bookings.",
        "adoption_channel": "Appointment operators, instructors, repair categories, and local service directories.",
        "staff_script": "DOGE can hold this appointment. Send the deposit through the link, then keep the confirmation in your booking record.",
        "proof_prompt": "Record deposit amount, booking category, refund policy, confirmation status, and merchant approval.",
        "next_step": "Turn the deposit proof into a booking-page template for similar operators.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "personal services",
    },
    {
        "key": "fixed-price-kiosk",
        "name": "Fixed-price Kiosk QR",
        "best_for": "Micro-markets, self-serve shelves, print tables, sticker boxes, vending-adjacent counters, and honesty stands.",
        "time": "Same day",
        "route": "Merchant wallet QR with a fixed USD price sign",
        "offer": "DOGE self-serve item, sticker pack, printed zine, snack shelf, or low-cost counter add-on",
        "placement": "Shelf label, kiosk card, product bin, checkout tray, and restock note.",
        "buyer_prompt": "Let buyers scan one fixed-price QR for a low-cost item that does not need custom checkout.",
        "merchant_setup": "Print a fixed-price QR, post the DOGE amount update rule, and reconcile counts against inventory at close.",
        "repeat_hook": "Restock the same DOGE shelf weekly and publish aggregate item counts with no buyer details.",
        "adoption_channel": "Micro-markets, hobby shops, event tables, campuses, and self-serve retail corners.",
        "staff_script": "DOGE is accepted for this fixed-price item. Scan the QR, send the amount shown, then take one item.",
        "proof_prompt": "Track item count, DOGE total, inventory reconciliation, and one shelf photo without buyer data.",
        "next_step": "Use the shelf report to recruit another self-serve location or hobby shop.",
        "audience": "merchant",
        "rail": "wallet",
        "vertical": "collectibles",
    },
    {
        "key": "community-class-seat",
        "name": "Community Class Seat",
        "best_for": "Studios, tutors, makerspaces, gyms, workshops, and community instructors.",
        "time": "1 day",
        "route": "Hosted booking link or merchant wallet payment URI",
        "offer": "DOGE-paid seat reservation, drop-in class, lesson slot, or workshop ticket",
        "placement": "Schedule page, booking confirmation, lobby QR, reminder email, and instructor script.",
        "buyer_prompt": "Let learners reserve one normal class seat with DOGE instead of creating a new product.",
        "merchant_setup": "Attach the DOGE route to one class listing and define cancellation, refund, and attendance rules before launch.",
        "repeat_hook": "Keep one recurring DOGE seat open each week and measure repeat attendance.",
        "adoption_channel": "Studios, tutors, makerspaces, gyms, and recurring local classes.",
        "staff_script": "DOGE can reserve this seat. Use the booking link or QR, include the class memo, and keep the confirmation for check-in.",
        "proof_prompt": "Record class type, seat count, route, refund policy, confirmation status, and instructor approval.",
        "next_step": "Turn the class proof into a booking-page template for similar instructors.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "local events",
    },
    {
        "key": "neighborhood-errand-board",
        "name": "Neighborhood Errand Board",
        "best_for": "Apartment groups, coworking spaces, community boards, campus clubs, and local service crews.",
        "time": "Same day",
        "route": "Merchant wallet QR or hosted payment link",
        "offer": "DOGE-paid micro-errand, pickup run, setup help, yard task, or small service bounty",
        "placement": "Community board, group chat, sign-in desk, task sheet, and recap post.",
        "buyer_prompt": "Use DOGE for a small helpful task that already happens inside the group.",
        "merchant_setup": "Name the task owner, post one QR or link beside the task, and define completion proof before anyone pays.",
        "repeat_hook": "Run the board weekly and keep only completed, permissioned tasks in public recaps.",
        "adoption_channel": "Neighborhood groups, clubs, coworking spaces, and service crews.",
        "staff_script": "DOGE is accepted for this task. Send through the posted route, include the task memo, and confirm completion with the owner.",
        "proof_prompt": "Track task category, route, payer count, completion confirmation, and whether worker permission allows aggregate reporting.",
        "next_step": "Use completed task data to recruit another community board or service group.",
        "audience": "merchant",
        "rail": "wallet",
        "vertical": "personal services",
    },
    {
        "key": "vendor-row-pass",
        "name": "Vendor Row Pass",
        "best_for": "Farmers markets, street fairs, hobby shows, swap meets, and main-street events with several sellers.",
        "time": "2 days",
        "route": "Hosted checkout links or merchant wallet QRs per vendor",
        "offer": "DOGE vendor-row punch card, sample bundle, table fee, or multi-stall discount",
        "placement": "Event map, vendor table cards, entrance sign, social post, and market recap.",
        "buyer_prompt": "Give attendees a reason to use DOGE at more than one stall during the same visit.",
        "merchant_setup": "Assign each participating vendor its own route, keep signage consistent, and reconcile each stall separately.",
        "repeat_hook": "Repeat the pass at the next market and compare vendor participation and repeat buyers.",
        "adoption_channel": "Market organizers, vendor rows, hobby shows, and main-street associations.",
        "staff_script": "DOGE is accepted at marked vendor tables today. Use the vendor's own QR or link and show confirmation at that table.",
        "proof_prompt": "Track participating vendors, completed DOGE orders, redacted examples, failed attempts, and organizer approval.",
        "next_step": "Use the multi-vendor recap to recruit the next market or street-fair organizer.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "local events",
    },
    {
        "key": "school-fundraiser-table",
        "name": "School Fundraiser Table",
        "best_for": "Booster clubs, parent groups, bake sales, band trips, robotics teams, and campus fundraisers.",
        "time": "1 day",
        "route": "Hosted payment link or dedicated fundraiser wallet QR",
        "offer": "DOGE fundraiser item, donation match, raffle ticket, snack table, or team-support bundle",
        "placement": "Fundraiser table, parent email, flyer QR, event program, and weekly impact update.",
        "buyer_prompt": "Let supporters use DOGE for the small fundraiser payments they already make.",
        "merchant_setup": "Use one dedicated campaign route, name the treasurer, and publish aggregate totals after the privacy review.",
        "repeat_hook": "Repeat the DOGE table at each fundraiser and compare sponsor matches, payer count, and repeat supporters.",
        "adoption_channel": "Booster networks, parent groups, school clubs, and neighborhood sponsors.",
        "staff_script": "DOGE is accepted for this fundraiser item. Scan the QR, include the campaign memo, and show confirmation before we mark it paid.",
        "proof_prompt": "Track payer count, DOGE total, USD estimate, sponsor disclosure, treasurer confirmation, and impact note.",
        "next_step": "Use the impact recap to recruit another club, team, or sponsor into a matched DOGE fundraiser.",
        "audience": "nonprofit",
        "rail": "hosted",
        "vertical": "school and booster clubs",
    },
    {
        "key": "sports-concession-window",
        "name": "Sports Concession Window",
        "best_for": "Youth leagues, local arenas, skate parks, race nights, club tournaments, and community sports events.",
        "time": "Same day",
        "route": "Merchant wallet QR at the concession stand",
        "offer": "DOGE snack combo, team sticker, parking add-on, raffle ticket, or tournament entry",
        "placement": "Concession sign, scoreboard announcement, volunteer phone, table tent, and recap post.",
        "buyer_prompt": "Let fans use DOGE for one familiar game-day purchase while they are already in line.",
        "merchant_setup": "Print a fixed-price QR for one item, keep the DOGE amount beside the USD price, and give volunteers one confirmation rule.",
        "repeat_hook": "Run the same DOGE window for each home game and track repeat buyers by aggregate count only.",
        "adoption_channel": "Booster clubs, league sponsors, concession vendors, and local fan communities.",
        "staff_script": "DOGE is live for this concession item. Scan here, send the amount shown, and show the confirmation screen.",
        "proof_prompt": "Record item count, DOGE total, USD value, volunteer confirmation, failed attempts, and one redacted receipt example.",
        "next_step": "Use the game-day recap to recruit another team, concession vendor, or sponsor.",
        "audience": "nonprofit",
        "rail": "wallet",
        "vertical": "sports and recreation",
    },
    {
        "key": "apartment-amenity-pass",
        "name": "Apartment Amenity Pass",
        "best_for": "Apartment communities, coworking spaces, gyms, parking lots, clubhouses, and shared amenities.",
        "time": "2 days",
        "route": "Hosted checkout link or property-controlled wallet QR",
        "offer": "DOGE guest pass, parking day pass, event room hold, coworking drop-in, or amenity upgrade",
        "placement": "Resident portal, lobby sign, QR at desk, community chat, and confirmation email.",
        "buyer_prompt": "Use DOGE for a small optional amenity payment inside a community people already visit.",
        "merchant_setup": "Attach the route to one optional amenity, define refund timing, and keep resident-identifying proof private.",
        "repeat_hook": "Run one monthly DOGE amenity window and report aggregate count, not resident details.",
        "adoption_channel": "Property managers, coworking operators, community boards, and local amenity vendors.",
        "staff_script": "DOGE can pay for this amenity pass today. Use the posted link or QR and keep the confirmation for the desk check-in.",
        "proof_prompt": "Track pass count, DOGE total, route, refund policy, desk confirmation, and privacy approval.",
        "next_step": "Use aggregate amenity proof to pitch another shared-space operator.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "residential communities",
    },
    {
        "key": "bookstore-trade-night",
        "name": "Bookstore Trade Night",
        "best_for": "Bookstores, record shops, game stores, comic shops, hobby retailers, and community retail nights.",
        "time": "1 day",
        "route": "Hosted checkout link or register-side wallet QR",
        "offer": "DOGE table fee, zine bundle, used-book credit, game-night seat, or limited collectible",
        "placement": "Event calendar, register sign, table card, receipt footer, and shop recap.",
        "buyer_prompt": "Let regulars use DOGE at the community night they already attend.",
        "merchant_setup": "Choose one low-risk item or event fee, place the QR at the register, and assign one staff proof owner.",
        "repeat_hook": "Repeat the DOGE table at the next trade night and compare returning buyers.",
        "adoption_channel": "Adjacent hobby shops, local creators, game groups, and main-street retail associations.",
        "staff_script": "DOGE is accepted for this event item. Scan the QR or use the link, then show confirmation at the register.",
        "proof_prompt": "Track item or seat count, DOGE total, redacted receipt, staff confirmation, and shop approval.",
        "next_step": "Use the trade-night recap to recruit another hobby retailer or creator table.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "bookstores and hobby retail",
    },
    {
        "key": "mobile-repair-bench",
        "name": "Mobile Repair Bench",
        "best_for": "Phone repair kiosks, bike shops, computer repair desks, tool libraries, and maker spaces.",
        "time": "1 day",
        "route": "Hosted invoice or merchant wallet payment URI",
        "offer": "DOGE diagnostic fee, rush add-on, parts deposit, tune-up slot, or repair pickup balance",
        "placement": "Intake form, repair ticket, pickup counter, booking text, and final receipt.",
        "buyer_prompt": "Use DOGE for a small repair fee where a ticket number and confirmation already exist.",
        "merchant_setup": "Attach the payment URI to one repair category and write the refund and parts-order rule before launch.",
        "repeat_hook": "Keep DOGE open for one repair category and track repeat customers after 30 days.",
        "adoption_channel": "Repair shops, maker communities, campus tech desks, and local service directories.",
        "staff_script": "DOGE can pay this repair fee. Send through the ticket link, include the ticket memo, and keep the confirmation for pickup.",
        "proof_prompt": "Record ticket category, route, DOGE amount, USD value, confirmation status, refund rule, and redacted merchant approval.",
        "next_step": "Turn repair proof into a service-counter template for similar operators.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "personal services",
    },
    {
        "key": "laundry-reload",
        "name": "Laundry Reload",
        "best_for": "Laundromats, apartment laundry rooms, wash-and-fold counters, dry cleaners, and dorm laundry desks.",
        "time": "Same day",
        "route": "Hosted checkout link or merchant wallet QR",
        "offer": "DOGE laundry credit, dryer add-on, wash-and-fold deposit, or detergent bundle",
        "placement": "Counter sign, machine-room QR, resident portal, receipt footer, and staff handoff card.",
        "buyer_prompt": "Let customers use DOGE for a small laundry payment they already make every week.",
        "merchant_setup": "Pick one fixed-price laundry credit, post the QR beside the counter or machine room, and reconcile against the daily closeout.",
        "repeat_hook": "Run one DOGE laundry window each week and compare repeat buyer count after 30 days.",
        "adoption_channel": "Apartment communities, laundromats, student housing, and neighborhood service counters.",
        "staff_script": "DOGE can pay for this laundry credit today. Scan the QR, show the confirmation, and we will mark the credit as paid.",
        "proof_prompt": "Track credit count, DOGE total, USD value, route, staff confirmation, and one redacted receipt or closeout line.",
        "next_step": "Use repeat laundry proof to invite nearby apartment communities and wash-and-fold counters.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "residential communities",
    },
    {
        "key": "parking-day-pass",
        "name": "Parking Day Pass",
        "best_for": "Event lots, coworking garages, gyms, markets, campuses, and neighborhood parking operators.",
        "time": "Same day",
        "route": "Merchant wallet QR or hosted checkout link",
        "offer": "DOGE day pass, event parking add-on, visitor pass, or reserved-space upgrade",
        "placement": "Gate sign, dashboard placard, QR at attendant stand, event map, and confirmation text.",
        "buyer_prompt": "Let drivers pay DOGE for a short parking pass where a fixed price and proof of payment already exist.",
        "merchant_setup": "Create one pass type, define the visible proof token, and give attendants the same confirmation rule.",
        "repeat_hook": "Repeat the pass for recurring events or weekly market days and track completed passes.",
        "adoption_channel": "Event organizers, venue operators, markets, gyms, campuses, and main-street parking groups.",
        "staff_script": "DOGE is accepted for this parking pass. Scan the QR, show the confirmation, and keep the visible pass on the dashboard.",
        "proof_prompt": "Record pass count, DOGE total, USD estimate, event name, failed attempts, and organizer approval.",
        "next_step": "Use the parking recap to recruit another event lot or venue with the same pass template.",
        "audience": "merchant",
        "rail": "wallet",
        "vertical": "local events",
    },
    {
        "key": "community-shuttle-pass",
        "name": "Community Shuttle Pass",
        "best_for": "Private event shuttles, venue loops, campus ride boards, parking shuttles, and volunteer transport.",
        "time": "Same day",
        "route": "Merchant wallet QR or hosted pass link",
        "offer": "DOGE shuttle pass, venue loop fare, ride-board contribution, or sponsor-paid seat",
        "placement": "Pickup sign, event map, driver card, group chat, parking booth, and confirmation text.",
        "buyer_prompt": "Let riders use DOGE for a fixed-price private shuttle or access pass where the route and pickup point are already known.",
        "merchant_setup": "Create one pass type, name the confirmation owner, and keep passenger identity out of public proof.",
        "repeat_hook": "Run the same pass on recurring event days and compare completed rides and failed attempts.",
        "adoption_channel": "Venues, event organizers, campus groups, parking operators, and private shuttle providers.",
        "staff_script": "DOGE can pay this pass today. Scan the QR or use the link, show confirmation at boarding, and keep the pass visible if required.",
        "proof_prompt": "Track pass count, DOGE total, USD estimate, route owner, privacy status, and event approval.",
        "next_step": "Use aggregate ride proof to pitch another venue or recurring event loop.",
        "audience": "merchant",
        "rail": "wallet",
        "vertical": "mobility and access",
    },
    {
        "key": "campus-print-pass",
        "name": "Campus Print Pass",
        "best_for": "Copy shops, maker spaces, school clubs, campus print desks, libraries, and coworking stations.",
        "time": "Same day",
        "route": "Merchant wallet QR",
        "offer": "DOGE print credit, sticker sheet, maker-hour pass, club flyer bundle, or zine table add-on",
        "placement": "Print counter, club table, maker station, QR beside the price list, and pickup shelf.",
        "buyer_prompt": "Use DOGE for a small print or maker credit where the order number already identifies the job.",
        "merchant_setup": "Pick one fixed credit, print the QR beside the price list, and ask buyers to include the job or pickup memo.",
        "repeat_hook": "Keep the same pass live for weekly clubs, maker nights, or campus events.",
        "adoption_channel": "Student orgs, hobby clubs, zine fairs, libraries, maker spaces, and copy counters.",
        "staff_script": "DOGE can pay for this print credit. Scan the QR, include the job memo, and show confirmation at pickup.",
        "proof_prompt": "Track job count, DOGE total, USD value, memo quality, staff confirmation, and a redacted receipt example.",
        "next_step": "Turn print-pass proof into a club onboarding template for the next campus or maker space.",
        "audience": "nonprofit",
        "rail": "wallet",
        "vertical": "school and booster clubs",
    },
    {
        "key": "coworking-day-desk",
        "name": "Coworking Day Desk",
        "best_for": "Coworking spaces, maker labs, study rooms, clubhouses, community workrooms, and venue lounges.",
        "time": "1 day",
        "route": "Hosted checkout link or front-desk wallet QR",
        "offer": "DOGE day desk, meeting-room hour, print credit, locker access, or community table seat",
        "placement": "Front desk, booking page, room calendar, member email, and door sign.",
        "buyer_prompt": "Let repeat visitors buy a fixed access pass with DOGE at the same desk where check-in already happens.",
        "merchant_setup": "Create one pass SKU, define the access window, and assign front-desk confirmation before launch.",
        "repeat_hook": "Run a weekly DOGE desk day and compare repeat visitors over 30 days.",
        "adoption_channel": "Coworking operators, maker spaces, apartment offices, libraries, and clubhouses.",
        "staff_script": "DOGE can pay for this day desk or room pass. Use the link or QR and show confirmation before check-in.",
        "proof_prompt": "Track pass count, DOGE total, access window, privacy approval, and one redacted closeout line.",
        "next_step": "Use the access-pass recap to recruit another shared-space operator.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "mobility and access",
    },
    {
        "key": "pet-care-deposit",
        "name": "Pet Care Deposit",
        "best_for": "Groomers, dog walkers, pet sitters, trainers, boarding desks, and neighborhood pet services.",
        "time": "1 day",
        "route": "Hosted invoice or merchant wallet payment URI",
        "offer": "DOGE appointment deposit, grooming add-on, training slot, boarding hold, or walker tip",
        "placement": "Booking page, reminder text, front-desk QR, intake form, and after-service receipt.",
        "buyer_prompt": "Let customers use DOGE for the small deposit or add-on that already confirms the booking.",
        "merchant_setup": "Attach the DOGE route to one service line and define cancellation, refund, and no-show rules before launch.",
        "repeat_hook": "Keep DOGE open for one recurring service and compare repeat booking behavior after 30 days.",
        "adoption_channel": "Pet service directories, neighborhood groups, appointment businesses, and local service crews.",
        "staff_script": "DOGE can hold this appointment or add this service. Use the link or QR, then keep the confirmation with the booking.",
        "proof_prompt": "Record service type, route, DOGE amount, USD value, refund rule, confirmation status, and merchant approval.",
        "next_step": "Use the booking proof to recruit adjacent appointment-based services.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "personal services",
    },
    {
        "key": "farm-box-pickup",
        "name": "Farm Box Pickup",
        "best_for": "CSA boxes, farm stands, produce co-ops, food halls, local grocers, and recurring pickup programs.",
        "time": "1-2 days",
        "route": "Hosted checkout link or merchant wallet QR",
        "offer": "DOGE produce box, pickup add-on, market bundle, local honey jar, or seasonal sample pack",
        "placement": "Pickup table, weekly order email, market sign, product label, and recap post.",
        "buyer_prompt": "Let regular pickup customers use DOGE for one seasonal product or add-on they already understand.",
        "merchant_setup": "Set one fixed-price pickup item, put the DOGE route in the weekly order message, and reconcile at pickup.",
        "repeat_hook": "Run the same DOGE pickup slot for four weeks and measure repeat buyers.",
        "adoption_channel": "Farm stands, market vendors, local grocers, CSA programs, and neighborhood food groups.",
        "staff_script": "DOGE is accepted for this pickup item. Use the link or QR, include the pickup memo, and show confirmation at the table.",
        "proof_prompt": "Track pickup count, DOGE total, USD estimate, vendor confirmation, failed attempts, and one redacted order summary.",
        "next_step": "Use the produce-box recap to recruit another vendor at the same market.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "food trucks and quick service",
    },
    {
        "key": "corner-store-staple",
        "name": "Corner Store Staple",
        "best_for": "Bodegas, convenience stores, delis, snack shops, campus markets, and late-night counters.",
        "time": "Same day",
        "route": "Merchant wallet QR or hosted checkout link",
        "offer": "DOGE staple item, drink-and-snack combo, phone charger, transit snack, or daily special",
        "placement": "Shelf tag, counter mat, receipt footer, staff register note, and window badge.",
        "buyer_prompt": "Let customers use DOGE for one everyday item that already has a fixed price and fast counter confirmation.",
        "merchant_setup": "Choose one low-risk SKU, post the DOGE amount beside the USD price, and reconcile DOGE sales against that SKU at close.",
        "repeat_hook": "Keep the same DOGE staple live for 30 days and measure repeat buyers by aggregate count.",
        "adoption_channel": "Nearby bodegas, delis, campus markets, and corner counters.",
        "staff_script": "DOGE can pay for this item today. Scan the QR or link, show the confirmation, and we will ring the staple as paid.",
        "proof_prompt": "Track item count, DOGE total, USD value, failed scans, staff confirmation, and one redacted closeout record.",
        "next_step": "Use the staple recap to recruit the next counter in the same walking route.",
        "audience": "merchant",
        "rail": "wallet",
        "vertical": "corner stores and bodegas",
    },
    {
        "key": "tool-library-rental",
        "name": "Tool Library Rental",
        "best_for": "Tool libraries, hardware stores, maker spaces, repair cafes, equipment desks, and neighborhood lending groups.",
        "time": "1 day",
        "route": "Hosted checkout link or merchant wallet QR",
        "offer": "DOGE tool rental deposit, maker-hour pass, repair bench slot, or equipment pickup fee",
        "placement": "Rental desk, booking page, checkout email, pickup shelf, and return reminder.",
        "buyer_prompt": "Let members use DOGE for a practical rental or deposit where the item, return date, and fee are already documented.",
        "merchant_setup": "Create one fixed rental or deposit product, name the return rule, and keep private borrower details out of public proof.",
        "repeat_hook": "Repeat the DOGE rental day weekly and compare repeat borrowers after the first month.",
        "adoption_channel": "Hardware stores, maker spaces, neighborhood groups, repair cafes, and community workshops.",
        "staff_script": "DOGE can cover this rental or deposit. Use the link or QR, then keep the confirmation with the checkout record.",
        "proof_prompt": "Record item class, route, DOGE amount, USD value, return rule, privacy status, and merchant approval.",
        "next_step": "Turn the rental proof into a pitch for adjacent repair desks and maker spaces.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "tool libraries and rentals",
    },
    {
        "key": "ev-charging-credit",
        "name": "EV Charging Credit",
        "best_for": "Local charging hosts, event lots, coworking garages, hotels, gyms, campuses, and apartment communities.",
        "time": "1-2 days",
        "route": "Hosted checkout link or merchant wallet QR",
        "offer": "DOGE charging credit, parking-plus-charge bundle, visitor top-up, or sponsor-paid charging window",
        "placement": "Charging sign, parking receipt, property app, attendant stand, and confirmation text.",
        "buyer_prompt": "Let drivers use DOGE for a fixed charging credit or parking bundle where the location and time window are clear.",
        "merchant_setup": "Set one credit amount, define who validates payment, and keep vehicle or resident identifiers out of public proof.",
        "repeat_hook": "Run the DOGE charging window on recurring event days and compare completed credits and failed attempts.",
        "adoption_channel": "Property managers, gyms, venues, campuses, parking operators, and charging hosts.",
        "staff_script": "DOGE can pay this charging credit today. Scan the route, show confirmation, and keep the credit note with the session record.",
        "proof_prompt": "Track credit count, DOGE total, USD estimate, location approval, privacy status, and failed attempts.",
        "next_step": "Use the charging recap to recruit another host with the same fixed-credit template.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "energy and charging",
    },
    {
        "key": "local-newsletter-membership",
        "name": "Local Newsletter Membership",
        "best_for": "Local newsletters, independent media, neighborhood blogs, podcasters, community calendars, and creator memberships.",
        "time": "1 day",
        "route": "Hosted checkout link or merchant wallet QR",
        "offer": "DOGE monthly membership, sponsor slot, premium guide, neighborhood calendar listing, or reader tip",
        "placement": "Subscribe page, pinned post, newsletter footer, membership email, and sponsor thank-you note.",
        "buyer_prompt": "Let readers use DOGE for a recurring or fixed-term membership that supports useful local information.",
        "merchant_setup": "Create one membership SKU, name the renewal period, and disclose any sponsor or paid-placement terms.",
        "repeat_hook": "Report DOGE-supported member count monthly and invite local merchants to sponsor the next issue.",
        "adoption_channel": "Independent newsletters, neighborhood pages, podcasts, creator communities, and sponsor directories.",
        "staff_script": "DOGE can support this membership. Use the link or QR, then keep the confirmation for your member record.",
        "proof_prompt": "Track membership count, DOGE total, USD estimate, disclosure status, and opt-in public quote permission.",
        "next_step": "Use reader proof to recruit merchants who already advertise with the local publication.",
        "audience": "creator",
        "rail": "hosted",
        "vertical": "local media and newsletters",
    },
    {
        "key": "counter-roundup-match",
        "name": "Counter Round-up Match",
        "best_for": "Counters, clubs, school tables, neighborhood drives, and merchants that already support a local cause.",
        "time": "Same day",
        "route": "Hosted donation link or dedicated merchant wallet QR",
        "offer": "DOGE round-up, sponsor match, register-side cause jar, or community drive add-on",
        "placement": "Register sign, receipt footer, volunteer script, sponsor note, and weekly impact recap.",
        "buyer_prompt": "Let buyers add a small DOGE contribution to a normal purchase or event table checkout.",
        "merchant_setup": "Use one dedicated campaign route, name the cause and match terms, and keep donor private details out of public proof.",
        "repeat_hook": "Run the same round-up window one day each week and report aggregate count, DOGE total, and impact note.",
        "adoption_channel": "Neighboring counters, civic groups, booster clubs, local sponsors, and mutual-aid drives.",
        "staff_script": "DOGE can fund this local round-up today. Scan the cause QR, show confirmation, and we will count it in the public aggregate total.",
        "proof_prompt": "Track contribution count, DOGE total, USD estimate, sponsor disclosure, impact note, failed scans, and privacy status.",
        "next_step": "Use the aggregate impact recap to invite another merchant to host the same cause window.",
        "audience": "nonprofit",
        "rail": "hosted",
        "vertical": "nonprofits",
    },
    {
        "key": "community-wifi-pass",
        "name": "Community Wi-Fi Pass",
        "best_for": "Cafes, coworking rooms, apartment lounges, maker spaces, study halls, and community workrooms.",
        "time": "1 day",
        "route": "Hosted checkout link or front-desk wallet QR",
        "offer": "DOGE day Wi-Fi pass, study-room hour, hotspot rental, print credit, or workroom access add-on",
        "placement": "Front desk, room sign, booking page, welcome email, and access-code handoff.",
        "buyer_prompt": "Let visitors buy a fixed access pass with DOGE where check-in and access-code handoff already happen.",
        "merchant_setup": "Create one fixed pass, define the access window, and keep device, resident, or student identifiers out of public proof.",
        "repeat_hook": "Run a weekly DOGE access hour and compare completed passes, failed attempts, and repeat visitors.",
        "adoption_channel": "Shared spaces, apartment communities, campuses, libraries, clubs, and local coworking operators.",
        "staff_script": "DOGE can pay for this access pass. Use the link or QR, show confirmation, and we will issue the access code or desk note.",
        "proof_prompt": "Track pass count, DOGE total, USD estimate, access window, privacy status, and one redacted closeout record.",
        "next_step": "Use the access recap to recruit another shared-space operator with the same pass template.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "digital services",
    },
    {
        "key": "vending-locker-qr",
        "name": "Vending Locker QR",
        "best_for": "Micro-markets, snack shelves, vending corners, equipment lockers, and self-serve pickup points.",
        "time": "Same day",
        "route": "Merchant wallet QR with a fixed-price placard",
        "offer": "DOGE snack shelf, locker pickup fee, equipment rental, or self-serve refill",
        "placement": "Machine label, shelf edge, locker door, break-room sign, and closeout sheet.",
        "buyer_prompt": "Let buyers scan DOGE for one fixed-price item where staff do not need to create a custom invoice.",
        "merchant_setup": "Post one QR per item class, print the USD reference beside it, and reconcile counts against inventory at close.",
        "repeat_hook": "Keep the DOGE shelf live for 30 days and compare repeat buyer count against restock cycles.",
        "adoption_channel": "Break rooms, apartment lobbies, maker spaces, campus corners, and micro-market operators.",
        "staff_script": "DOGE is accepted for this self-serve item. Scan the posted QR, send the amount shown, and keep the confirmation for any receipt question.",
        "proof_prompt": "Track item count, DOGE total, restock timing, route, failed scans, and one redacted closeout line.",
        "next_step": "Use the self-serve recap to recruit another micro-market, lobby shelf, or campus pickup point.",
        "audience": "merchant",
        "rail": "wallet",
        "vertical": "vending and micro-markets",
    },
    {
        "key": "neighborhood-delivery-add-on",
        "name": "Neighborhood Delivery Add-on",
        "best_for": "Local delivery teams, couriers, restaurant runners, farm box routes, and community errand groups.",
        "time": "1 day",
        "route": "Hosted checkout link or merchant wallet QR",
        "offer": "DOGE delivery tip, rush add-on, curbside fee, or last-mile sponsor",
        "placement": "Order-ready SMS, driver card, pickup counter, route recap, and receipt footer.",
        "buyer_prompt": "Let buyers use DOGE for a small delivery-related add-on at the moment they already expect a handoff.",
        "merchant_setup": "Attach one DOGE route to the delivery note and define who confirms payment before the driver leaves.",
        "repeat_hook": "Run the DOGE add-on across one recurring route and measure repeat use by aggregate count.",
        "adoption_channel": "Restaurant delivery loops, farm box routes, courier groups, and neighborhood errands.",
        "staff_script": "DOGE can pay this delivery add-on. Use the link or QR in the handoff note, then show confirmation before closeout.",
        "proof_prompt": "Track add-on count, DOGE total, delivery route, confirmation owner, and one redacted handoff record.",
        "next_step": "Use the route recap to pitch another delivery loop or pickup counter with the same add-on.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "delivery and logistics",
    },
    {
        "key": "meal-train-voucher",
        "name": "Meal Train Voucher",
        "best_for": "Family support drives, faith groups, parent networks, neighborhood associations, and mutual-aid meal organizers.",
        "time": "1 day",
        "route": "Hosted checkout link or dedicated campaign wallet QR",
        "offer": "DOGE meal voucher, grocery card, delivery-credit pledge, or sponsor-matched dinner slot",
        "placement": "Meal-train page, group chat, flyer QR, organizer email, and weekly impact update.",
        "buyer_prompt": "Let supporters use DOGE to fund one concrete meal slot or grocery voucher instead of a vague donation.",
        "merchant_setup": "Use a dedicated route, name the organizer, publish aggregate totals, and keep recipient identity out of public proof.",
        "repeat_hook": "Run the DOGE voucher window for each support drive and compare completed slots, failed scans, and sponsor matches.",
        "adoption_channel": "Faith groups, parent networks, local restaurants, mutual-aid teams, and grocery partners.",
        "staff_script": "DOGE can fund this meal voucher. Scan the route, include the campaign memo, and we will count it in the aggregate update after privacy review.",
        "proof_prompt": "Track voucher count, DOGE total, USD estimate, sponsor disclosure, organizer confirmation, and recipient privacy status.",
        "next_step": "Use the impact recap to recruit one restaurant or grocery partner into the next meal-support window.",
        "audience": "nonprofit",
        "rail": "hosted",
        "vertical": "gift cards and closed-loop credit",
        "proof_route": "gift card route",
    },
    {
        "key": "festival-wristband-topup",
        "name": "Festival Wristband Top-up",
        "best_for": "Street fairs, music nights, markets, food halls, hobby shows, and private festival operators with stored-value wristbands.",
        "time": "2 days",
        "route": "Hosted checkout link or event-controlled wallet QR",
        "offer": "DOGE wristband top-up, drink ticket bundle, vendor credit, sample pass, or merch credit",
        "placement": "Entrance booth, event map, vendor row signs, wristband desk, and recap post.",
        "buyer_prompt": "Let attendees turn DOGE into event credit before they walk the vendor row.",
        "merchant_setup": "Create one stored-value SKU, assign the top-up desk, reconcile each vendor separately, and write the refund rule before gates open.",
        "repeat_hook": "Repeat the top-up at the next event and report redemption count instead of only purchased credit.",
        "adoption_channel": "Festival organizers, market operators, vendor associations, food halls, and sponsor teams.",
        "staff_script": "DOGE can top up this event credit. Use the desk QR or link, then keep the confirmation until the wristband or pass is loaded.",
        "proof_prompt": "Track top-ups, redemptions, participating vendors, DOGE total, refund handling, failed attempts, and organizer approval.",
        "next_step": "Use redemption proof to recruit another event organizer that already runs stored-value passes.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "gift cards and closed-loop credit",
        "proof_route": "gift card route",
    },
    {
        "key": "repair-cafe-parts-jar",
        "name": "Repair Cafe Parts Jar",
        "best_for": "Repair cafes, maker spaces, tool libraries, bike co-ops, school robotics teams, and volunteer fix-it events.",
        "time": "Same day",
        "route": "Dedicated wallet QR or hosted donation link",
        "offer": "DOGE parts jar, replacement-part fund, bench-hour sponsor, tool-restock credit, or volunteer pizza fund",
        "placement": "Repair bench sign, intake form, parts bin, volunteer script, and event recap.",
        "buyer_prompt": "Let visitors use DOGE for the small parts and bench costs that keep a repair event running.",
        "merchant_setup": "Post one route at intake, name the fund purpose, and keep repaired-item or visitor details out of public proof.",
        "repeat_hook": "Run the parts jar at each repair day and compare repaired-item count with DOGE-funded supplies.",
        "adoption_channel": "Tool libraries, makerspaces, bike co-ops, hardware stores, schools, and repair volunteers.",
        "staff_script": "DOGE can support the parts jar today. Scan the QR, include the repair memo if useful, and we will report aggregate support after the event.",
        "proof_prompt": "Track contribution count, DOGE total, item categories, supply use, volunteer confirmation, and privacy status.",
        "next_step": "Use the repair-day recap to recruit a hardware sponsor or another maker space with the same jar.",
        "audience": "nonprofit",
        "rail": "wallet",
        "vertical": "tool libraries and rentals",
    },
    {
        "key": "neighborhood-welcome-pack",
        "name": "Neighborhood Welcome Pack",
        "best_for": "Apartment communities, coworking spaces, campus housing, neighborhood groups, relocation desks, and main-street associations.",
        "time": "1-2 days",
        "route": "Hosted checkout link or property-controlled wallet QR",
        "offer": "DOGE welcome pack, local coupon bundle, amenity starter credit, newcomer event pass, or merchant crawl card",
        "placement": "Welcome email, lobby sign, resident portal, orientation table, and local merchant map.",
        "buyer_prompt": "Let newcomers use DOGE for a small local starter bundle that introduces nearby merchants and shared amenities.",
        "merchant_setup": "Bundle one property or group route with named local partners, define redemption rules, and report only aggregate participation.",
        "repeat_hook": "Run the welcome pack monthly and compare repeat use at partner merchants after 30 days.",
        "adoption_channel": "Property managers, relocation desks, coworking operators, campuses, and main-street merchant groups.",
        "staff_script": "DOGE can buy this welcome pack. Use the link or QR, keep the confirmation, and redeem with the listed local partners.",
        "proof_prompt": "Track pack count, DOGE total, partner redemption count, privacy status, failed attempts, and organizer approval.",
        "next_step": "Use partner redemption proof to recruit one more local merchant into the next welcome pack.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "residential communities",
    },
    {
        "key": "library-friends-book-sale",
        "name": "Library Friends Book Sale",
        "best_for": "Library friends groups, book fairs, school book tables, zine swaps, hobby clubs, and used-book fundraisers.",
        "time": "Same day",
        "route": "Hosted checkout link or dedicated table wallet QR",
        "offer": "DOGE book bundle, shelf sponsor, used-book bag, zine pack, or reading-club donation",
        "placement": "Sale table sign, checkout box, bookmark insert, event listing, and recap note.",
        "buyer_prompt": "Let readers use DOGE for a low-cost book sale item where volunteer checkout is already simple.",
        "merchant_setup": "Create one table route, set fixed bundle prices, and keep buyer names and library-card details out of public proof.",
        "repeat_hook": "Run the DOGE book-sale table monthly and compare completed bundles, failed scans, and repeat supporters.",
        "adoption_channel": "Library friends groups, used bookstores, school book fairs, zine clubs, and hobby retailers.",
        "staff_script": "DOGE is accepted for this book-sale bundle. Scan the table QR, show confirmation, and we will mark the bundle paid.",
        "proof_prompt": "Track bundle count, DOGE total, USD estimate, volunteer confirmation, privacy status, and one redacted closeout line.",
        "next_step": "Use the book-sale recap to recruit one nearby hobby retailer or school table into the same simple bundle.",
        "audience": "nonprofit",
        "rail": "hosted",
        "vertical": "bookstores and hobby retail",
    },
    {
        "key": "senior-center-meal-ticket",
        "name": "Senior Center Meal Ticket",
        "best_for": "Senior centers, community kitchens, faith groups, service clubs, and neighborhood lunch programs.",
        "time": "1 day",
        "route": "Hosted donation link or dedicated campaign wallet QR",
        "offer": "DOGE meal ticket, sponsor table, coffee hour fund, pantry voucher, or ride-and-lunch support",
        "placement": "Lunch desk, bulletin board, volunteer script, sponsor note, and weekly aggregate update.",
        "buyer_prompt": "Let supporters fund one concrete meal ticket or lunch-table need with DOGE instead of a vague support ask.",
        "merchant_setup": "Use a dedicated route, name the meal program owner, publish aggregate totals, and never expose recipient identity.",
        "repeat_hook": "Repeat the DOGE meal-ticket window on the same lunch day each month and report only aggregate impact.",
        "adoption_channel": "Senior centers, faith groups, community kitchens, service clubs, and local restaurant partners.",
        "staff_script": "DOGE can fund this meal ticket. Scan the campaign route, include the meal memo, and we will count it after privacy review.",
        "proof_prompt": "Track ticket count, DOGE total, USD estimate, sponsor disclosure, organizer confirmation, and recipient privacy status.",
        "next_step": "Use the aggregate meal-ticket recap to recruit one restaurant sponsor or neighboring community kitchen.",
        "audience": "nonprofit",
        "rail": "hosted",
        "vertical": "nonprofits",
    },
    {
        "key": "gym-drop-in-pass",
        "name": "Gym Drop-in Pass",
        "best_for": "Independent gyms, yoga studios, climbing walls, rec centers, pickleball groups, and sports clubs.",
        "time": "1 day",
        "route": "Hosted checkout link or front-desk wallet QR",
        "offer": "DOGE drop-in pass, open-gym hour, class seat, court fee, towel card, or guest-day upgrade",
        "placement": "Front desk, class page, booking email, court sign, and member newsletter.",
        "buyer_prompt": "Let visitors use DOGE for a fixed drop-in pass where check-in already confirms access.",
        "merchant_setup": "Create one fixed pass, name the access window and refund rule, and keep member identity out of public proof.",
        "repeat_hook": "Run a weekly DOGE drop-in hour and compare repeat visitors after 30 days.",
        "adoption_channel": "Independent gyms, studios, recreation centers, sports leagues, and local wellness groups.",
        "staff_script": "DOGE can pay for this drop-in pass. Use the link or QR, show confirmation, and we will check you in for the listed window.",
        "proof_prompt": "Track pass count, DOGE total, USD value, access window, failed attempts, and merchant approval.",
        "next_step": "Use drop-in proof to recruit another studio or club that already sells fixed access passes.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "sports and recreation",
    },
    {
        "key": "community-fridge-restock",
        "name": "Community Fridge Restock",
        "best_for": "Community fridges, mutual-aid groups, pantry shelves, neighborhood associations, and grocery partners.",
        "time": "Same day",
        "route": "Dedicated wallet QR or hosted donation link",
        "offer": "DOGE fridge restock, water case, staple shelf, grocery-card pledge, or sponsor-matched produce run",
        "placement": "Fridge sign, volunteer group chat, grocery partner counter, route recap, and weekly impact post.",
        "buyer_prompt": "Let supporters use DOGE to fund one visible restock category with aggregate reporting and no recipient tracking.",
        "merchant_setup": "Use one dedicated campaign route, name the restock purpose, disclose sponsors, and keep recipient data out of every proof artifact.",
        "repeat_hook": "Run the same DOGE restock window weekly and compare completed restocks, failed scans, and sponsor matches.",
        "adoption_channel": "Mutual-aid teams, grocery partners, neighborhood associations, food drives, and local sponsors.",
        "staff_script": "DOGE can fund this restock. Scan the campaign QR, include the restock memo, and we will report aggregate totals after privacy review.",
        "proof_prompt": "Track restock count, DOGE total, USD estimate, grocery partner confirmation, sponsor disclosure, and recipient privacy status.",
        "next_step": "Use the restock recap to recruit one grocery partner or sponsor for the next weekly window.",
        "audience": "nonprofit",
        "rail": "wallet",
        "vertical": "nonprofits",
    },
    {
        "key": "home-service-callout",
        "name": "Home Service Callout",
        "best_for": "Independent repair techs, cleaners, lawn crews, appliance helpers, handypeople, and neighborhood service boards.",
        "time": "1 day",
        "route": "Hosted checkout link or merchant wallet payment URI",
        "offer": "DOGE callout deposit, yard-work add-on, emergency visit hold, materials prepay, or service-tip closeout",
        "placement": "Booking page, quote SMS, fridge magnet, service truck card, invoice footer, and technician closeout note.",
        "buyer_prompt": "Let customers use DOGE for a fixed deposit or add-on in a home-service flow that already needs a quote and confirmation.",
        "merchant_setup": "Create one fixed deposit SKU, name the refund and no-show rule, and tell the technician what payment screen counts as ready to dispatch.",
        "repeat_hook": "Offer the DOGE callout window for one route or one service day each week and compare repeat jobs.",
        "adoption_channel": "Home repair directories, neighborhood errand groups, service dispatchers, hardware partners, and property managers.",
        "staff_script": "DOGE can cover this service deposit. Use the quote link or QR, show confirmation, and we will apply it to the final invoice.",
        "proof_prompt": "Track deposit count, DOGE total, USD value, service category, refund status, failed attempts, and one redacted invoice line.",
        "next_step": "Use the service-route recap to recruit another local operator that already takes deposits.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "home services",
    },
    {
        "key": "block-sale-price-tag",
        "name": "Block Sale Price Tag",
        "best_for": "Yard sales, block sales, flea tables, swap meets, porch pickup bins, and community resale days.",
        "time": "Same day",
        "route": "Merchant wallet QR with fixed-price tags",
        "offer": "DOGE price tag, bundle table, porch pickup box, swap meet special, or resale fundraiser item",
        "placement": "Price tag, table sign, porch pickup note, seller phone lock screen, and closeout sheet.",
        "buyer_prompt": "Let buyers scan DOGE for a clearly priced used item where the seller can confirm payment on the spot.",
        "merchant_setup": "Print one QR for the seller wallet, write USD prices beside items, and keep a simple tally of DOGE-paid tags.",
        "repeat_hook": "Run the same QR at the next block sale and compare item count, failed scans, and repeat buyers.",
        "adoption_channel": "Neighborhood associations, flea-market rows, hobby swaps, resale groups, school tables, and porch pickup sellers.",
        "staff_script": "DOGE is accepted for these tagged items. Scan the seller QR, send the listed amount, and show confirmation before taking the item.",
        "proof_prompt": "Track item count, DOGE total, USD estimate, seller approval, failed scans, and one redacted tag or receipt photo.",
        "next_step": "Use the block-sale recap to invite the next seller row or neighborhood association into the same tag setup.",
        "audience": "merchant",
        "rail": "wallet",
        "vertical": "local events",
    },
    {
        "key": "print-ship-desk",
        "name": "Print & Ship Desk",
        "best_for": "Copy shops, shipping counters, campus desks, maker spaces, notary tables, mailrooms, and small business centers.",
        "time": "Same day",
        "route": "Hosted checkout link or front-desk wallet QR",
        "offer": "DOGE copy pack, label print, shipping add-on, notary desk fee, scan bundle, or maker-station credit",
        "placement": "Counter placard, price list, receipt footer, pickup shelf, desk QR, and confirmation stamp.",
        "buyer_prompt": "Let customers use DOGE for a fixed front-desk task where staff already check the order before handoff.",
        "merchant_setup": "Create one fixed service SKU, put the route beside the price list, and define who stamps or marks the order paid.",
        "repeat_hook": "Keep the desk route live for 30 days and report completed tasks, failed scans, and returning customers.",
        "adoption_channel": "Copy shops, campus desks, coworking spaces, mailrooms, maker stations, and small business centers.",
        "staff_script": "DOGE can pay for this desk service. Use the link or QR, show confirmation, and we will stamp the order paid before pickup.",
        "proof_prompt": "Track task count, DOGE total, USD estimate, route, staff confirmation, failed attempts, and one redacted closeout line.",
        "next_step": "Use the front-desk proof to recruit another service counter that already sells fixed small tasks.",
        "audience": "merchant",
        "rail": "hosted",
        "vertical": "digital services",
    },
    {
        "key": "transit-stop-micro-stand",
        "name": "Transit Stop Micro-Stand",
        "best_for": "Private shuttle stops, bike corrals, campus loops, venue queues, pop-up water tables, and neighborhood route volunteers.",
        "time": "Same day",
        "route": "Merchant wallet QR with fixed-price sign",
        "offer": "DOGE water bottle, snack pack, poncho, bike-light battery, ride-day add-on, or route support tip",
        "placement": "Stop sign, volunteer table, shuttle schedule board, bike corral, queue placard, and recap post.",
        "buyer_prompt": "Let riders and walkers use DOGE for a small fixed-price item at the moment they already stop.",
        "merchant_setup": "Post one QR beside the route or queue, pin USD prices, and assign one person to confirm the payment screen before handoff.",
        "repeat_hook": "Run the stand during the same commute, event, or campus window and compare completed scans with failed attempts.",
        "adoption_channel": "Shuttle operators, bike groups, campus desks, venue queues, neighborhood associations, and mobility volunteers.",
        "staff_script": "DOGE can pay for this stand item. Scan the route QR, show confirmation, and we will mark the item handed off.",
        "proof_prompt": "Track item count, DOGE total, USD estimate, route window, failed scans, and operator approval.",
        "next_step": "Use the stop-window recap to recruit one adjacent route, queue, bike group, or campus desk.",
        "audience": "merchant",
        "rail": "wallet",
        "vertical": "mobility and access",
    },
    {
        "key": "community-garden-credit",
        "name": "Community Garden Credit",
        "best_for": "Community gardens, nurseries, compost co-ops, seed swaps, apartment gardens, and local food groups.",
        "time": "1 day",
        "route": "Hosted checkout link or garden wallet QR",
        "offer": "DOGE seedling tray, compost bucket drop, raised-bed share, tool hour, plant sale bundle, or harvest-table credit",
        "placement": "Garden gate sign, plant table, workday clipboard, nursery counter, member email, and weekly recap.",
        "buyer_prompt": "Let neighbors use DOGE for a small garden credit tied to food, soil, seeds, or shared tools.",
        "merchant_setup": "Name the garden owner, set one fixed credit or bundle, define who confirms redemption, and keep member details out of public proof.",
        "repeat_hook": "Run the same DOGE garden window on workdays or plant-sale days and compare repeat supporters.",
        "adoption_channel": "Community gardens, nurseries, compost teams, apartment associations, food co-ops, and local sponsors.",
        "staff_script": "DOGE can cover this garden credit. Use the link or QR, show confirmation, and we will mark the credit redeemed.",
        "proof_prompt": "Track credit count, DOGE total, USD estimate, garden use, sponsor disclosure, and privacy status.",
        "next_step": "Use the garden recap to recruit one nursery, food co-op, apartment garden, or compost partner.",
        "audience": "nonprofit",
        "rail": "hosted",
        "vertical": "community gardens and circular reuse",
    },
    {
        "key": "hardware-parts-drawer",
        "name": "Hardware Parts Drawer",
        "best_for": "Neighborhood hardware stores, bike co-ops, maker spaces, repair desks, tool libraries, and small parts counters.",
        "time": "Same day",
        "route": "Front-counter wallet QR or hosted checkout link",
        "offer": "DOGE bolt pack, bike tube, fuse kit, fastener drawer, 3D-print filament, repair part add-on, or tool bench consumable",
        "placement": "Parts bin, counter mat, repair intake desk, tool checkout sheet, shelf tag, and closeout note.",
        "buyer_prompt": "Let buyers use DOGE for the small part that finishes a repair instead of turning the whole store into a crypto checkout.",
        "merchant_setup": "Choose one parts drawer or consumable SKU, post the route beside the bin, and define who marks the line item paid.",
        "repeat_hook": "Keep the DOGE drawer live for 30 days and compare completed parts, failed scans, and repeat repair customers.",
        "adoption_channel": "Hardware stores, bike co-ops, repair cafes, maker spaces, tool libraries, and maintenance groups.",
        "staff_script": "DOGE can pay for this parts drawer item. Use the link or QR, show confirmation, and we will mark the part paid.",
        "proof_prompt": "Track part count, DOGE total, USD estimate, item category, failed attempts, and one redacted closeout line.",
        "next_step": "Use the parts-drawer proof to recruit another repair counter or hardware partner with the same fixed-bin setup.",
        "audience": "merchant",
        "rail": "wallet",
        "vertical": "tool libraries and rentals",
    },
    {
        "key": "local-arts-tip-window",
        "name": "Local Arts Tip Window",
        "best_for": "Open mics, gallery openings, street performers, zine tables, studio nights, venue lobbies, and community arts groups.",
        "time": "Same day",
        "route": "Creator wallet QR or hosted tip link",
        "offer": "DOGE tip window, song request, gallery postcard, zine mini, studio support ticket, or performer merch add-on",
        "placement": "Stage sign, gallery placard, merch table, performer card, event listing, and thank-you recap.",
        "buyer_prompt": "Let supporters use DOGE during the arts moment they are already watching, browsing, or tipping.",
        "merchant_setup": "Use one artist or venue route, name the supported work, disclose sponsors, and separate public proof from private fan details.",
        "repeat_hook": "Run the DOGE tip window at recurring shows or gallery nights and compare repeat supporters.",
        "adoption_channel": "Venues, galleries, creator communities, zine fairs, music nights, local media, and arts nonprofits.",
        "staff_script": "DOGE can support this artist or table today. Scan the QR, include the show memo if useful, and keep confirmation for the recap.",
        "proof_prompt": "Track contribution count, DOGE total, USD estimate, supported artist or table, permission status, and privacy review.",
        "next_step": "Use the arts-window recap to recruit one adjacent performer, gallery, venue, or creator market.",
        "audience": "creator",
        "rail": "wallet",
        "vertical": "local events",
    },
]

SETUP_STEPS = [
    {
        "kicker": "1",
        "title": "Choose the route",
        "summary": "Hosted checkout for low operations burden, merchant wallet for pilots, native backend for builders.",
    },
    {
        "kicker": "2",
        "title": "Define the offer",
        "summary": "Pick one product or service, set USD pricing, write refund and volatility language, then assign an owner.",
    },
    {
        "kicker": "3",
        "title": "Create the payment instruction",
        "summary": "Generate a processor invoice, payment link, or Dogecoin URI with the merchant-owned receiving address.",
    },
    {
        "kicker": "4",
        "title": "Test before launch",
        "summary": "Run one low-value payment, confirm receipt, record fees and timing, then document the cash-out route.",
    },
    {
        "kicker": "5",
        "title": "Collect proof",
        "summary": "Save the route label, amounts, redacted receipt, permission status, and next action for public reporting.",
    },
]

ROUTE_GUIDE = [
    {
        "name": "Hosted checkout",
        "use": "Best when the merchant wants invoices, settlement tooling, and fewer wallet operations.",
        "first_step": "Create a current payment link or invoice in the provider dashboard and confirm DOGE or settlement-asset support.",
        "risk": "Processor support, fees, settlement currency, and refund rules can change.",
    },
    {
        "name": "Merchant wallet QR",
        "use": "Best for small pilots, events, creator sales, tips, and direct merchant-controlled acceptance.",
        "first_step": "Generate a fresh native DOGE receiving address, build the URI, and print a visible QR with the USD amount.",
        "risk": "The merchant owns key security, reconciliation, volatility, and irreversible-transfer checks.",
    },
    {
        "name": "DOGE-native backend",
        "use": "Best for teams that can run infrastructure and want repeatable DOGE checkout inside their product.",
        "first_step": "Use a tested backend, label confirmations clearly, and keep accounting/export fields from day one.",
        "risk": "Engineering and support burden is higher, so start after the checkout policy is stable.",
    },
]

TRANSACTION_CLARITY_STEPS = [
    {
        "kicker": "Buyer",
        "title": "Sees one price",
        "summary": "Show the USD price, DOGE estimate, refund note, and exact QR or checkout link before the buyer scans.",
    },
    {
        "kicker": "Wallet",
        "title": "Sends to merchant route",
        "summary": "Use the merchant-owned wallet, hosted invoice, or native checkout route named in the setup packet.",
    },
    {
        "kicker": "Staff",
        "title": "Confirms paid status",
        "summary": "Staff mark the order paid only after the agreed confirmation signal, amount check, and receipt note.",
    },
    {
        "kicker": "Merchant",
        "title": "Settles and records",
        "summary": "The merchant records fees, cash-out timing, and only the privacy-safe facts needed for support.",
    },
]

WEEKLY_CADENCE = [
    ("Monday", "Review pipeline, confirm launches, assign creator visits."),
    ("Tuesday", "Onboard merchants, verify offer copy, collect media."),
    ("Wednesday", "Push creator content and publish the updated merchant list."),
    ("Thursday", "Run spotlight content and amplify proof-of-purchase posts."),
    ("Friday", "Feature leaderboard movement and collect testimonials."),
    ("Weekend", "Publish recap, top merchants, and next-wave onboarding calls."),
]

LAUNCH_CHECKLIST = [
    "Merchant selects one DOGE-ready offer.",
    "Payment method, wallet flow, or processor route is confirmed.",
    "Buyer-facing sign or link names the exact offer, USD reference, and DOGE route.",
    "Volatility, refund, tax, and disclosure copy is reviewed.",
    "Staff handoff explains amount, confirmation, cash-out route, and proof owner.",
    "Website badge, QR code, and launch post are ready.",
    "Proof intake and privacy review are assigned.",
    "Report date and methodology are published before launch.",
]


def base_context(active, request=None):
    base_url = site_base_url(request)
    page = SEO_BY_ACTIVE.get(active, SEO_BY_ACTIVE["home"])
    canonical_url = absolute_site_url(page["path"], base_url)
    og_image_url = absolute_site_url(static("commerce/img/doge-logo-256.png"), base_url)
    return {
        "active": active,
        "baseline": BASELINE,
        "segments": SEGMENTS,
        "rails": RAILS,
        "guardrails": GUARDRAILS,
        "donation_address": DONATION_ADDRESS,
        "doge_logo_data_uri": doge_logo_data_uri(),
        "asset_version": ASSET_VERSION,
        "site_name": SITE_NAME,
        "site_url": base_url,
        "canonical_url": canonical_url,
        "meta_title": page["title"],
        "meta_description": page["description"],
        "meta_keywords": SEO_KEYWORDS,
        "og_image_url": og_image_url,
        "structured_data_json": structured_data(active, base_url),
    }


def home(request):
    context = base_context("home", request) | {
        "dashboard_steps": DASHBOARD_STEPS,
        "role_paths": ROLE_PATHS,
        "adoption_lanes": ADOPTION_LANES[:6],
        "commerce_packs": COMMERCE_PACKS[:5],
    }
    return render(request, "commerce/home.html", context)


def merchant_kit(request):
    return render(request, "commerce/merchant_kit.html", base_context("merchant_kit", request))


def pos_terminal(request):
    return render(request, "commerce/pos_terminal.html", base_context("pos_terminal", request))


def statistics(request):
    return render(request, "commerce/statistics.html", base_context("statistics", request))


def faq(request):
    return render(request, "commerce/faq.html", base_context("faq", request))


def technical_details(request):
    return render(request, "commerce/technical_details.html", base_context("technical_details", request))


def playbook(request):
    context = base_context("playbook", request) | {
        "adoption_moves": ADOPTION_MOVES,
        "roadmap": ROADMAP,
        "metrics": METRICS,
        "weekly_cadence": WEEKLY_CADENCE,
        "launch_checklist": LAUNCH_CHECKLIST,
        "playbook_market_kits": PLAYBOOK_MARKET_KITS,
        "quick_commerce_kits": QUICK_COMMERCE_KITS,
    }
    return render(request, "commerce/playbook.html", context)


def robots_txt(request):
    base_url = site_base_url(request)
    group_agents = [
        "*",
        "Googlebot",
        "Googlebot-Image",
        "OAI-SearchBot",
        "GPTBot",
        "ChatGPT-User",
    ]
    lines = [
        "# DOGE Commerce Kit crawler policy",
        "# Public pages are open for search and AI discovery; APIs and parameterized QR images are excluded.",
        "# Grok/xAI crawlers are covered by the generic User-agent: * rules until xAI publishes a stable public crawler token.",
        "",
    ]
    for agent in group_agents:
        lines.extend(
            [
                f"User-agent: {agent}",
                "Allow: /",
                "Disallow: /api/",
                "Disallow: /qr.svg",
                "",
            ]
        )
    lines.extend(
        [
            f"Sitemap: {absolute_site_url('/sitemap.xml', base_url)}",
            f"LLMs: {absolute_site_url('/llms.txt', base_url)}",
            "",
        ]
    )
    return HttpResponse("\n".join(lines), content_type="text/plain; charset=utf-8")


def sitemap_xml(request):
    base_url = site_base_url(request)
    lastmod = time.strftime("%Y-%m-%d", time.gmtime())
    urls = []
    for page in SEO_PAGES:
        loc = xml_escape(absolute_site_url(page["path"], base_url))
        urls.append(
            "\n".join(
                [
                    "  <url>",
                    f"    <loc>{loc}</loc>",
                    f"    <lastmod>{lastmod}</lastmod>",
                    f"    <changefreq>{page['changefreq']}</changefreq>",
                    f"    <priority>{page['priority']}</priority>",
                    "  </url>",
                ]
            )
        )
    sitemap = "\n".join(
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
            *urls,
            "</urlset>",
            "",
        ]
    )
    return HttpResponse(sitemap, content_type="application/xml; charset=utf-8")


def llms_txt(request):
    base_url = site_base_url(request)
    page_lines = [f"- {page['nav']}: {absolute_site_url(page['path'], base_url)} - {page['description']}" for page in SEO_PAGES]
    body = "\n".join(
        [
            "# DOGE Commerce Kit",
            "",
            "DOGE Commerce Kit is a free, MIT-licensed, non-custodial Dogecoin commerce toolkit for merchants, builders, and communities.",
            "The site focuses on practical checkout setup: wallet addresses, Dogecoin payment URIs, QR codes, browser-stored POS orders, blockchain balance checks, transaction validation, donation snippets, adoption playbooks, and live market context.",
            "",
            "Important crawler notes:",
            "- Public content pages are intended for search and AI crawler indexing.",
            "- API endpoints and parameterized QR image URLs are not primary documentation and are excluded in robots.txt.",
            "- The kit does not custody funds, move DOGE, or provide investment advice.",
            "",
            "Useful pages:",
            *page_lines,
            "",
            "Canonical sitemap:",
            f"- {absolute_site_url('/sitemap.xml', base_url)}",
            "",
        ]
    )
    return HttpResponse(body, content_type="text/plain; charset=utf-8")


def health(request):
    return JsonResponse({"status": "ok"})


def rate_status(request):
    providers = {}
    for key in ("blockchair", "blockcypher"):
        entry = SERVER_RATE_STATE.get(key, {})
        providers[key] = {
            "used": entry.get("used", 0),
            "limit": entry.get("limit", 0),
            "status": entry.get("status", "ready"),
            "last_error": entry.get("last_error", ""),
            "provider_name": entry.get("provider_name", ""),
            "updated_at": entry.get("updated_at", 0),
        }
    return JsonResponse({"providers": providers, "updated_at": utc_now_iso()})


def wallet_balance(request):
    address = request.GET.get("address", "").strip()
    if not valid_doge_address(address):
        return JsonResponse({"error": "Enter a valid Dogecoin mainnet address."}, status=400)
    try:
        return JsonResponse(latest_balance(address))
    except DogeLookupError as exc:
        return JsonResponse({"error": str(exc)}, status=503)


def wallet_transactions(request):
    address = request.GET.get("address", "").strip()
    if not valid_doge_address(address):
        return JsonResponse({"error": "Enter a valid Dogecoin mainnet address."}, status=400)
    try:
        limit = min(100, max(1, int(request.GET.get("limit", 10) or 10)))
    except (TypeError, ValueError):
        limit = 10
    try:
        return JsonResponse(latest_transactions(address, limit))
    except DogeLookupError as exc:
        return JsonResponse({"error": str(exc)}, status=503)


def latest_utxos(address, limit=50):
    errors = []
    try:
        return blockchair_utxos(address, limit)
    except Exception as exc:
        errors.append(DogeLookupError(provider_error_message(BLOCKCHAIR_PROVIDER_NAME, exc), provider=BLOCKCHAIR_PROVIDER_NAME))
    if DOGE_ENABLE_BLOCKCYPHER_FALLBACK:
        try:
            return blockcypher_utxos(address, limit)
        except Exception as exc:
            errors.append(DogeLookupError(provider_error_message(BLOCKCYPHER_PROVIDER_NAME, exc), provider=BLOCKCYPHER_PROVIDER_NAME))
    raise DogeLookupError(doge_lookup_failure(errors, "UTXO lookup"))


def latest_broadcast(raw_hex):
    errors = []
    try:
        return blockchair_broadcast(raw_hex)
    except Exception as exc:
        errors.append(DogeLookupError(provider_error_message(BLOCKCHAIR_PROVIDER_NAME, exc), provider=BLOCKCHAIR_PROVIDER_NAME))
    if DOGE_ENABLE_BLOCKCYPHER_FALLBACK:
        try:
            return blockcypher_broadcast(raw_hex)
        except Exception as exc:
            errors.append(DogeLookupError(provider_error_message(BLOCKCYPHER_PROVIDER_NAME, exc), provider=BLOCKCYPHER_PROVIDER_NAME))
    raise DogeLookupError(doge_lookup_failure(errors, "Broadcast"))


def wallet_utxos(request):
    address = request.GET.get("address", "").strip()
    if not valid_doge_address(address):
        return JsonResponse({"error": "Enter a valid Dogecoin mainnet address."}, status=400)
    try:
        limit = min(100, max(1, int(request.GET.get("limit", 50) or 50)))
    except (TypeError, ValueError):
        limit = 50
    try:
        return JsonResponse(latest_utxos(address, limit))
    except DogeLookupError as exc:
        return JsonResponse({"error": str(exc)}, status=503)


@csrf_exempt
def wallet_broadcast(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST a JSON body with raw hex transaction data."}, status=405)
    try:
        body = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON body."}, status=400)
    raw_hex = re.sub(r"[^0-9a-fA-F]", "", str(body.get("hex", "")))
    if len(raw_hex) < 20:
        return JsonResponse({"error": "Enter a valid signed transaction hex payload."}, status=400)
    try:
        return JsonResponse(latest_broadcast(raw_hex))
    except DogeLookupError as exc:
        return JsonResponse({"error": str(exc)}, status=503)


@csrf_exempt
def transaction_validate(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST a JSON body with txid, address, doge, and min_confirmations."}, status=405)
    try:
        body = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON body."}, status=400)

    txid = str(body.get("txid", "")).strip()
    address = str(body.get("address", "")).strip()
    if not re.fullmatch(r"[0-9a-fA-F]{64}", txid):
        return JsonResponse({"error": "Enter a 64-character Dogecoin transaction ID."}, status=400)
    if not valid_doge_address(address):
        return JsonResponse({"error": "Enter a valid Dogecoin mainnet address."}, status=400)
    try:
        expected_atoms = doge_atoms(body.get("doge", 0))
        min_confirmations = max(0, int(body.get("min_confirmations", 0) or 0))
    except (TypeError, ValueError) as exc:
        return JsonResponse({"error": str(exc)}, status=400)

    try:
        payload, source_url, provider_name = latest_transaction(txid)
    except DogeLookupError as exc:
        return JsonResponse({"error": str(exc)}, status=503)

    matches = []
    for output in transaction_outputs(payload):
        if address in output_addresses(output):
            value = doge_atoms_from_chain(output.get("value"))
            matches.append(
                {
                    "doge": doge_units(value),
                    "value": value,
                    "script_type": output.get("script_type") or (output.get("scriptPubKey") or {}).get("type", ""),
                }
            )
    matched_atoms = sum(item["value"] for item in matches)
    confirmations = safe_int(payload.get("confirmations"), 0)
    errors = []
    if matched_atoms <= 0:
        errors.append("No output pays the loaded merchant address.")
    if expected_atoms > 0 and matched_atoms < expected_atoms:
        errors.append("Matched output is below the expected DOGE amount.")
    if confirmations < min_confirmations:
        errors.append("Transaction has fewer confirmations than required.")

    return JsonResponse(
        {
            "txid": payload.get("hash") or payload.get("txid") or txid,
            "source": source_url,
            "provider_name": provider_name,
            "passed": not errors,
            "status": "confirmed" if not errors else "needs_review",
            "errors": errors,
            "confirmations": confirmations,
            "matched_doge": doge_units(matched_atoms),
            "expected_doge": doge_units(expected_atoms),
            "matches": matches,
            "updated_at": utc_now_iso(),
        }
    )


def qr_svg(request):
    data = request.GET.get("data", "").strip()
    if not data:
        data = f"dogecoin:{DONATION_ADDRESS}?message=DOGE%20Commerce%20Kit%20donation"
    data = data[:700]
    image = qrcode.make(data, image_factory=qrcode.image.svg.SvgPathImage, box_size=12)
    stream = BytesIO()
    image.save(stream)
    return HttpResponse(stream.getvalue(), content_type="image/svg+xml")


def doge_distribution(request):
    now = time.time()
    cached = RICH_LIST_CACHE["payload"]
    if cached and now - RICH_LIST_CACHE["loaded_at"] < 900:
        return JsonResponse(cached)

    payload = {
        "source": f"{BLOCKCHAIR_BASE_URL}/stats",
        "provider_name": BLOCKCHAIR_PROVIDER_NAME,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
        "top": [],
        "buckets": [
            {"label": "Top 1 address", "percent": 28.4, "range": "Largest known holder"},
            {"label": "Top 2-5", "percent": 18.6, "range": "2nd through 5th"},
            {"label": "Top 6-10", "percent": 11.2, "range": "6th through 10th"},
            {"label": "Top 11-25", "percent": 17.5, "range": "11th through 25th"},
            {"label": "Outside top 25", "percent": 24.3, "range": "Remaining supply"},
        ],
        "status": "baseline",
    }

    try:
        throttle_server_provider("blockchair", 1.2)
        stats_url = blockchair_api_url("/stats")
        stats_payload = fetch_json(stats_url)
        circulation = doge_atoms_from_chain((stats_payload.get("data") or {}).get("circulation"))
        if circulation > 0:
            payload["status"] = "live"
            payload["circulation_doge"] = doge_units(circulation)
            payload["source"] = stats_url
    except Exception as exc:
        payload["status"] = "baseline"
        payload["error"] = str(exc)

    RICH_LIST_CACHE["loaded_at"] = now
    RICH_LIST_CACHE["payload"] = payload
    return JsonResponse(payload)

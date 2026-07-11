"""Lightweight per-IP rate limiting for the JSON API endpoints.

The API relays lookups and transaction broadcasts to third-party Dogecoin
providers, so a single abusive client could burn the site's shared provider
quota. This fixed-window limiter is in-process (per gunicorn worker), which is
plenty for a single-host deployment; multiply the limit by worker count when
reasoning about totals.
"""
import os
import time
from collections import defaultdict, deque

from django.http import JsonResponse

API_PREFIX = "/api/"
WINDOW_SECONDS = 60


def _int_env(name, default):
    try:
        return max(1, int(os.environ.get(name, default) or default))
    except (TypeError, ValueError):
        return default


class ApiRateLimitMiddleware:
    """Allow up to DOGE_API_RATE_LIMIT requests per client IP per minute on /api/ paths."""

    def __init__(self, get_response):
        self.get_response = get_response
        self.limit = _int_env("DOGE_API_RATE_LIMIT", 60)
        self.hits = defaultdict(deque)
        self.last_prune = time.monotonic()

    def client_ip(self, request):
        forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "unknown")

    def prune(self, now):
        if now - self.last_prune < WINDOW_SECONDS:
            return
        self.last_prune = now
        stale = [ip for ip, entries in self.hits.items() if not entries or now - entries[-1] > WINDOW_SECONDS]
        for ip in stale:
            del self.hits[ip]

    def __call__(self, request):
        if request.path.startswith(API_PREFIX):
            now = time.monotonic()
            entries = self.hits[self.client_ip(request)]
            while entries and now - entries[0] > WINDOW_SECONDS:
                entries.popleft()
            if len(entries) >= self.limit:
                retry_after = max(1, int(WINDOW_SECONDS - (now - entries[0])))
                response = JsonResponse(
                    {"error": "Rate limit exceeded. Slow down and retry shortly."},
                    status=429,
                )
                response["Retry-After"] = str(retry_after)
                return response
            entries.append(now)
            self.prune(now)
        return self.get_response(request)

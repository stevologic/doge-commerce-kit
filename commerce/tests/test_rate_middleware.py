from django.http import JsonResponse
from django.test import RequestFactory, SimpleTestCase

from commerce.middleware import ApiRateLimitMiddleware


class ApiRateLimitMiddlewareTests(SimpleTestCase):
    def build_middleware(self, limit):
        middleware = ApiRateLimitMiddleware(lambda request: JsonResponse({"ok": True}))
        middleware.limit = limit
        return middleware

    def test_api_requests_over_limit_get_429_with_retry_after(self):
        middleware = self.build_middleware(limit=3)
        factory = RequestFactory()
        statuses = [middleware(factory.get("/api/rate-status/")).status_code for _ in range(5)]
        self.assertEqual(statuses[:3], [200, 200, 200])
        self.assertEqual(statuses[3:], [429, 429])
        response = middleware(factory.get("/api/rate-status/"))
        self.assertEqual(response.status_code, 429)
        self.assertTrue(int(response["Retry-After"]) >= 1)

    def test_non_api_paths_are_never_limited(self):
        middleware = self.build_middleware(limit=1)
        factory = RequestFactory()
        statuses = [middleware(factory.get("/pos/")).status_code for _ in range(10)]
        self.assertEqual(statuses, [200] * 10)

    def test_limits_are_tracked_per_client_ip(self):
        middleware = self.build_middleware(limit=1)
        factory = RequestFactory()
        first = middleware(factory.get("/api/rate-status/", REMOTE_ADDR="10.0.0.1"))
        second = middleware(factory.get("/api/rate-status/", REMOTE_ADDR="10.0.0.2"))
        blocked = middleware(factory.get("/api/rate-status/", REMOTE_ADDR="10.0.0.1"))
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(blocked.status_code, 429)

    def test_forwarded_for_header_wins_behind_proxy(self):
        middleware = self.build_middleware(limit=1)
        factory = RequestFactory()
        first = middleware(factory.get("/api/rate-status/", HTTP_X_FORWARDED_FOR="203.0.113.9", REMOTE_ADDR="172.18.0.2"))
        blocked = middleware(factory.get("/api/rate-status/", HTTP_X_FORWARDED_FOR="203.0.113.9", REMOTE_ADDR="172.18.0.2"))
        other = middleware(factory.get("/api/rate-status/", HTTP_X_FORWARDED_FOR="203.0.113.10", REMOTE_ADDR="172.18.0.2"))
        self.assertEqual(first.status_code, 200)
        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(other.status_code, 200)

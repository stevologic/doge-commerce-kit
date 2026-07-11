"""Django settings for the consolidated DOGE2MOON site."""
from pathlib import Path
import os

from django.core.exceptions import ImproperlyConfigured


BASE_DIR = Path(__file__).resolve().parent.parent

INSECURE_DEFAULT_KEYS = {"", "dev-only-doge2moon-secret", "local-compose-doge2moon-change-me", "change-me"}
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-only-doge2moon-secret")
DEBUG = os.environ.get("DJANGO_DEBUG", "true").lower() in {"1", "true", "yes", "on"}

if not DEBUG and SECRET_KEY in INSECURE_DEFAULT_KEYS:
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY is unset or still a known default. Generate one with "
        "`python -c \"import secrets; print(secrets.token_urlsafe(50))\"` and set it in the environment."
    )

allowed_hosts = os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,0.0.0.0")
ALLOWED_HOSTS = [host.strip() for host in allowed_hosts.split(",") if host.strip()]

INSTALLED_APPS = [
    "django.contrib.staticfiles",
    "commerce",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "commerce.middleware.ApiRateLimitMiddleware",
]

X_FRAME_OPTIONS = "DENY"
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"

# Behind the bundled Caddy reverse proxy, which terminates TLS and always
# redirects HTTP to HTTPS. Trust its forwarded-proto header so Django knows
# requests are secure, and emit HSTS on production responses.
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_HSTS_SECONDS = int(os.environ.get("DJANGO_HSTS_SECONDS", "31536000") or 0)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = os.environ.get("DJANGO_HSTS_INCLUDE_SUBDOMAINS", "false").lower() in {"1", "true", "yes", "on"}
    SECURE_HSTS_PRELOAD = False

_site_url = (os.environ.get("DOGE_SITE_URL") or os.environ.get("SITE_URL") or "").rstrip("/")
if _site_url.startswith("https://"):
    CSRF_TRUSTED_ORIGINS = [_site_url]

ROOT_URLCONF = "doge2moon.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
            ],
        },
    },
]

WSGI_APPLICATION = "doge2moon.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

LANGUAGE_CODE = "en-us"
TIME_ZONE = "America/Phoenix"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

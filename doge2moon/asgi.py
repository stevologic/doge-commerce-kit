"""ASGI config for DOGE2MOON."""
import os

from django.core.asgi import get_asgi_application


os.environ.setdefault("DJANGO_SETTINGS_MODULE", "doge2moon.settings")

application = get_asgi_application()

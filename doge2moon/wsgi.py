"""WSGI config for DOGE2MOON."""
import os

from django.core.wsgi import get_wsgi_application


os.environ.setdefault("DJANGO_SETTINGS_MODULE", "doge2moon.settings")

application = get_wsgi_application()

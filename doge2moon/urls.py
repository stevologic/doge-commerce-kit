"""Root URL configuration for DOGE2MOON."""
from django.urls import include, path


urlpatterns = [
    path("", include("commerce.urls")),
]

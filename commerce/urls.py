from django.urls import path
from django.views.generic import RedirectView

from . import views


app_name = "commerce"

urlpatterns = [
    path("", views.home, name="home"),
    path("wallet/", RedirectView.as_view(url="/pos/", permanent=True)),
    path("pos/", views.pos_terminal, name="pos_terminal"),
    path("merchant-kit/", views.merchant_kit, name="merchant_kit"),
    path("statistics/", views.statistics, name="statistics"),
    path("playbook/", views.playbook, name="playbook"),
    path("faq/", views.faq, name="faq"),
    path("technical-details/", views.technical_details, name="technical_details"),
    path("robots.txt", views.robots_txt, name="robots_txt"),
    path("sitemap.xml", views.sitemap_xml, name="sitemap_xml"),
    path("llms.txt", views.llms_txt, name="llms_txt"),
    path("qr.svg", views.qr_svg, name="qr_svg"),
    path("api/wallet/balance/", views.wallet_balance, name="wallet_balance"),
    path("api/wallet/transactions/", views.wallet_transactions, name="wallet_transactions"),
    path("api/wallet/utxos/", views.wallet_utxos, name="wallet_utxos"),
    path("api/wallet/broadcast/", views.wallet_broadcast, name="wallet_broadcast"),
    path("api/transaction/validate/", views.transaction_validate, name="transaction_validate"),
    path("api/doge-distribution/", views.doge_distribution, name="doge_distribution"),
    path("health/", views.health, name="health"),
    path("api/rate-status/", views.rate_status, name="rate_status"),
]

"""commerce.dog/shop/ catalog and campaign settings.

Edit PEN_SHIP_BY when a mail date is set. Flip PRINTFUL_CATALOG_LIVE when a
separate commerce.dog Printful store exists and product cards should stop
showing the launching-soon state.

The hero mockup lives at PEN_HERO_IMAGE.
"""

PRINTFUL_CATALOG_LIVE = False
PEN_SHIP_BY = "TBA"
PEN_SHIP_BY_LABEL = f"Pens ship by: {PEN_SHIP_BY}"
PEN_RUN_TOTAL = 120
PEN_VARIANT_COUNT = 60
PEN_PROMO_LIMIT = 100
PEN_HERO_IMAGE = "commerce/img/shop/pineapple-pen-variants.webp"
PEN_HERO_WIDTH = 1400
PEN_HERO_HEIGHT = 1024
PEN_HERO_ALT = "Two pineapple-Doge pens: DOGE PINEAPPLE and PINEAPPLE DOGE"

PEN_VARIANTS = [
    {"name": "DOGE PINEAPPLE", "count": PEN_VARIANT_COUNT},
    {"name": "PINEAPPLE DOGE", "count": PEN_VARIANT_COUNT},
]

SHOP_PRODUCTS = [
    {
        "slug": "classic-doge-mug",
        "name": "Classic Doge mug",
        "price": "11.99",
        "image": "commerce/img/shop/classic-doge-mug.jpg",
        "alt": "White ceramic mug with a cartoon Shiba and the words such wow, very mug, much brew",
    },
    {
        "slug": "to-the-moon-mug",
        "name": "To the moon mug",
        "price": "11.99",
        "image": "commerce/img/shop/to-the-moon-mug.jpg",
        "alt": "White ceramic mug with a cartoon Shiba astronaut riding a rocket and the words to the moon",
    },
    {
        "slug": "very-currency-mug",
        "name": "Very currency mug",
        "price": "11.99",
        "image": "commerce/img/shop/very-currency-mug.jpg",
        "alt": "White ceramic mug with a cartoon Shiba stacking Dogecoin and the words very currency",
    },
    {
        "slug": "sticker-pack",
        "name": "Doge sticker pack",
        "price": "8.99",
        "image": "commerce/img/shop/sticker-pack.jpg",
        "alt": "Sticker sheet with six cartoon Shiba designs including a pineapple Doge sticker",
    },
    {
        "slug": "pay-with-doge-tee",
        "name": "Pay with DOGE tee",
        "price": "18.99",
        "image": "commerce/img/shop/pay-with-doge-tee.jpg",
        "alt": "Black and white t-shirts printed with a cartoon Shiba coin and the words Pay with DOGE",
    },
    {
        "slug": "poster",
        "name": "To the moon poster",
        "price": "17.99",
        "image": "commerce/img/shop/poster.jpg",
        "alt": "Framed poster of a cartoon Shiba astronaut waving under the words to the moon",
    },
]

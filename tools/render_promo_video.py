from pathlib import Path
import math

import imageio.v2 as imageio
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import PIL


ROOT = Path(__file__).resolve().parents[1]
FRAME_DIR = ROOT / "docs" / "promo-frames"
OUT_DIR = ROOT / "commerce" / "static" / "commerce" / "video"
OUT_MP4 = OUT_DIR / "doge-commerce-kit-promo.mp4"
OUT_POSTER = OUT_DIR / "doge-commerce-kit-promo-poster.jpg"

WIDTH = 1280
HEIGHT = 720
FPS = 24

SLIDES = [
    ("home.png", "Accept Dogecoin in minutes", "Wallet, price, QR, confirmation. The merchant flow stays simple."),
    ("wallet.png", "Generate or load a wallet", "Use watch-only balance checks and keep merchant control of the receiving address."),
    ("pos.png", "Run a Doge point of sale", "Create a payment request, save local orders, confirm before fulfillment."),
    ("tools.png", "Copy QR and site snippets", "Build payment links, Donate DOGE buttons, and self-contained accepted badges."),
    ("statistics.png", "Watch market context live", "See DOGE/USD, candles, trade flow, and the $1 market-cap scenario."),
    ("technical.png", "Integrate when ready", "Use reusable files, webhook notes, URI formats, and local QR generation."),
]


def font(size, bold=False):
    pil_font_dir = Path(PIL.__file__).resolve().parent / "fonts"
    candidates = [
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        pil_font_dir / ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"),
    ]
    for candidate in candidates:
        path = Path(candidate)
        if path.exists():
            return ImageFont.truetype(str(path), size)
    try:
        return ImageFont.truetype("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf", size)
    except OSError:
        pass
    return ImageFont.load_default()


FONT_TITLE = font(46, True)
FONT_BODY = font(24)
FONT_LABEL = font(17, True)
FONT_SMALL = font(15, True)


def ease(value):
    return 0.5 - math.cos(max(0, min(1, value)) * math.pi) / 2


def cover_crop(image, target_w, target_h, zoom=1.0, pan_x=0.5, pan_y=0.42):
    src_w, src_h = image.size
    scale = max(target_w / src_w, target_h / src_h) * zoom
    crop_w = target_w / scale
    crop_h = target_h / scale
    left = (src_w - crop_w) * pan_x
    top = (src_h - crop_h) * pan_y
    crop = image.crop((left, top, left + crop_w, top + crop_h))
    return crop.resize((target_w, target_h), Image.Resampling.LANCZOS)


def rounded_mask(size, radius):
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    return mask


def paste_card(base, screenshot, box, radius=26, shadow=True):
    x, y, w, h = box
    if shadow:
        shadow_layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
        shadow_draw = ImageDraw.Draw(shadow_layer)
        shadow_draw.rounded_rectangle((x + 16, y + 20, x + w + 16, y + h + 20), radius=radius, fill=(0, 0, 0, 68))
        shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(24))
        base.alpha_composite(shadow_layer)
    mask = rounded_mask((w, h), radius)
    card = screenshot.resize((w, h), Image.Resampling.LANCZOS)
    border = Image.new("RGBA", (w + 4, h + 4), (0, 0, 0, 0))
    border_draw = ImageDraw.Draw(border)
    border_draw.rounded_rectangle((0, 0, w + 3, h + 3), radius=radius + 2, outline=(244, 189, 42, 230), width=4)
    base.alpha_composite(border, (x - 2, y - 2))
    base.paste(card, (x, y), mask)


def draw_wrapped(draw, text, xy, max_width, font_obj, fill, line_gap=8):
    x, y = xy
    words = text.split()
    line = ""
    for word in words:
        test = f"{line} {word}".strip()
        if draw.textbbox((0, 0), test, font=font_obj)[2] <= max_width:
            line = test
        else:
            draw.text((x, y), line, font=font_obj, fill=fill)
            y += font_obj.size + line_gap
            line = word
    if line:
        draw.text((x, y), line, font=font_obj, fill=fill)
        y += font_obj.size + line_gap
    return y


def draw_background(frame_i):
    base = Image.new("RGBA", (WIDTH, HEIGHT), (249, 250, 244, 255))
    draw = ImageDraw.Draw(base)
    for x in range(0, WIDTH, 44):
        alpha = 17 if x % 88 else 26
        draw.line((x, 0, x, HEIGHT), fill=(15, 143, 120, alpha), width=1)
    for y in range(0, HEIGHT, 44):
        alpha = 16 if y % 88 else 25
        draw.line((0, y, WIDTH, y), fill=(15, 143, 120, alpha), width=1)

    glow = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    t = frame_i / FPS
    glow_draw.ellipse((800 + math.sin(t) * 30, -140, 1420, 460), fill=(244, 189, 42, 62))
    glow_draw.ellipse((-140, 380 + math.cos(t * 0.7) * 22, 460, 980), fill=(15, 143, 120, 44))
    glow = glow.filter(ImageFilter.GaussianBlur(56))
    base.alpha_composite(glow)
    return base


def render_slide(frame_i, screenshot, title, body, slide_index, local_t, total_t):
    progress = local_t / total_t
    move = ease(progress)
    base = draw_background(frame_i)
    draw = ImageDraw.Draw(base)

    zoom = 1.03 + move * 0.055
    pan_x = 0.47 + math.sin(progress * math.pi) * 0.04
    pan_y = 0.36 + slide_index * 0.008
    card_img = cover_crop(screenshot, 820, 506, zoom=zoom, pan_x=pan_x, pan_y=pan_y)

    card_x = int(390 - (1 - move) * 52)
    card_y = 108
    paste_card(base, card_img, (card_x, card_y, 820, 506))

    panel = Image.new("RGBA", (430, 420), (0, 0, 0, 0))
    panel_draw = ImageDraw.Draw(panel)
    panel_draw.rounded_rectangle((0, 0, 430, 420), radius=26, fill=(23, 23, 21, 235), outline=(244, 189, 42, 160), width=2)
    base.alpha_composite(panel, (70, 160))

    x = 104
    y = 202
    draw.text((x, y), "DOGE COMMERCE KIT", font=FONT_LABEL, fill=(244, 189, 42, 255))
    title_bottom = draw_wrapped(draw, title, (x, y + 42), 340, FONT_TITLE, (255, 255, 255, 255), line_gap=3)
    draw_wrapped(draw, body, (x, title_bottom + 18), 340, FONT_BODY, (222, 239, 247, 255), line_gap=8)

    cta_y = 516
    draw.rounded_rectangle((x, cta_y, x + 188, cta_y + 48), radius=10, fill=(244, 189, 42, 255))
    draw.text((x + 18, cta_y + 14), "Open the kit", font=FONT_SMALL, fill=(15, 15, 14, 255))
    draw.rounded_rectangle((x + 206, cta_y, x + 342, cta_y + 48), radius=10, fill=(255, 255, 255, 244))
    draw.text((x + 224, cta_y + 14), "Show QR", font=FONT_SMALL, fill=(15, 15, 14, 255))

    dot_x = 70
    for idx in range(len(SLIDES)):
        fill = (244, 189, 42, 255) if idx == slide_index else (255, 255, 255, 96)
        draw.ellipse((dot_x + idx * 18, 628, dot_x + idx * 18 + 9, 637), fill=fill)

    draw.rounded_rectangle((70, 662, 1210, 670), radius=5, fill=(255, 255, 255, 70))
    draw.rounded_rectangle((70, 662, 70 + int(1140 * ((slide_index + progress) / len(SLIDES))), 670), radius=5, fill=(244, 189, 42, 255))
    return base.convert("RGB")


def render_final(frame_i, local_t, total_t):
    progress = ease(local_t / total_t)
    base = draw_background(frame_i)
    draw = ImageDraw.Draw(base)
    logo_path = ROOT / "commerce" / "static" / "commerce" / "img" / "doge-logo-256.png"
    if logo_path.exists():
        logo = Image.open(logo_path).convert("RGBA").resize((188, 188), Image.Resampling.LANCZOS)
        logo = logo.rotate(math.sin(progress * math.pi * 2) * 4, resample=Image.Resampling.BICUBIC, expand=True)
        base.alpha_composite(logo, (WIDTH - 275, 94))

    draw.text((84, 112), "DOGE COMMERCE KIT", font=FONT_LABEL, fill=(91, 98, 95, 255))
    draw_wrapped(draw, "Accept Dogecoin without turning checkout into a science project.", (84, 162), 760, FONT_TITLE, (23, 23, 21, 255), line_gap=3)
    draw_wrapped(draw, "Save a wallet, generate a QR, confirm the transaction, and keep the proof. Built for merchants, creators, clubs, and anyone who wants DOGE to be useful in real life.", (88, 384), 820, FONT_BODY, (54, 73, 82, 255), line_gap=9)

    steps = [("1", "Set wallet"), ("2", "Show QR"), ("3", "Confirm payment")]
    for idx, (num, label) in enumerate(steps):
        x = 102 + idx * 270
        y = 544
        draw.rounded_rectangle((x, y, x + 228, y + 88), radius=18, fill=(255, 255, 255, 222), outline=(15, 91, 99, 42), width=1)
        draw.ellipse((x + 18, y + 25, x + 58, y + 65), fill=(23, 23, 21, 255))
        draw.text((x + 32, y + 36), num, font=FONT_SMALL, fill=(255, 255, 255, 255))
        draw.text((x + 76, y + 33), label, font=FONT_LABEL, fill=(23, 23, 21, 255))

    draw.rounded_rectangle((958, 548, 1192, 612), radius=14, fill=(244, 189, 42, 255))
    draw.text((991, 570), "Try it on the front page", font=FONT_LABEL, fill=(15, 15, 14, 255))
    return base.convert("RGB")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    screenshots = []
    for filename, _, _ in SLIDES:
        image = Image.open(FRAME_DIR / filename).convert("RGB")
        screenshots.append(image)

    with imageio.get_writer(
        OUT_MP4,
        fps=FPS,
        codec="libx264",
        quality=8,
        macro_block_size=16,
        output_params=["-pix_fmt", "yuv420p", "-movflags", "+faststart"],
    ) as writer:
        frame_i = 0
        for slide_index, ((_, title, body), screenshot) in enumerate(zip(SLIDES, screenshots)):
            duration = 2.2
            total_frames = int(duration * FPS)
            for local_frame in range(total_frames):
                frame = render_slide(frame_i, screenshot, title, body, slide_index, local_frame / FPS, duration)
                writer.append_data(np.asarray(frame))
                if frame_i == 4:
                    frame.save(OUT_POSTER, quality=92)
                frame_i += 1
        final_duration = 2.4
        for local_frame in range(int(final_duration * FPS)):
            writer.append_data(np.asarray(render_final(frame_i, local_frame / FPS, final_duration)))
            frame_i += 1

    print(f"Wrote {OUT_MP4}")
    print(f"Wrote {OUT_POSTER}")


if __name__ == "__main__":
    main()

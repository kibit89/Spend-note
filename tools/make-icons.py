#!/usr/bin/env python3
"""Draws the Spend Note icons (SVG source + PNG variants) with PIL."""
import os
from PIL import Image, ImageDraw

OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024  # working resolution


def make(size, art_scale=1.0, radius_ratio=0.219, bg=True):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if bg:
        # vertical gradient inside a rounded-square mask
        grad = Image.new("RGB", (S, S))
        gd = ImageDraw.Draw(grad)
        top = (18, 144, 127)
        bottom = (10, 91, 82)
        for y in range(S):
            t = y / (S - 1)
            gd.line([(0, y), (S, y)], fill=(
                int(top[0] + (bottom[0] - top[0]) * t),
                int(top[1] + (bottom[1] - top[1]) * t),
                int(top[2] + (bottom[2] - top[2]) * t),
            ))
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * radius_ratio), fill=255)
        img.paste(grad, (0, 0), mask)

    # white ₩ glyph, drawn on its own layer so it can be scaled for maskable icons
    art = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ad = ImageDraw.Draw(art)
    stroke = int(S * 0.060)
    pts = [(120, 168), (192, 344), (256, 196), (320, 344), (392, 168)]
    pts = [(x * S / 512, y * S / 512) for x, y in pts]
    ad.line(pts, fill=(255, 255, 255, 255), width=stroke, joint="curve")
    for p in (pts[0], pts[-1]):
        r = stroke / 2
        ad.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=(255, 255, 255, 255))
    bar_w = int(S * 0.055)
    for y in (252, 302):
        yy = y * S / 512
        ad.line([(118 * S / 512, yy), (394 * S / 512, yy)], fill=(255, 255, 255, 255), width=bar_w)
        r = bar_w / 2
        for x in (118 * S / 512, 394 * S / 512):
            ad.ellipse([x - r, yy - r, x + r, yy + r], fill=(255, 255, 255, 255))

    if art_scale != 1.0:
        inner = int(S * art_scale)
        art = art.resize((inner, inner), Image.LANCZOS)
        layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        off = (S - inner) // 2
        layer.paste(art, (off, off), art)
        art = layer

    img.alpha_composite(art)
    return img.resize((size, size), Image.LANCZOS)


def main():
    make(512).save(os.path.join(OUT, "icon-512.png"))
    make(192).save(os.path.join(OUT, "icon-192.png"))
    make(512, art_scale=0.74).save(os.path.join(OUT, "icon-maskable-512.png"))
    make(180, radius_ratio=0.0).save(os.path.join(OUT, "apple-touch-icon.png"))
    make(32).save(os.path.join(OUT, "favicon-32.png"))
    print("icons written to", OUT)


if __name__ == "__main__":
    main()

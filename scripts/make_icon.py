#!/usr/bin/env python3
"""Compose a 1024x1024 app-icon source from a cat frame on a warm rounded-square
background, then hand it to `tauri icon` to generate every platform size. Not shipped."""
import os
from PIL import Image, ImageDraw

CAT = os.path.join(os.path.dirname(__file__), "..", "src", "assets", "cat")
OUT = os.path.join(os.path.dirname(__file__), "..", "icon_source.png")

SZ = 1024


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def vertical_gradient(size, top, bottom):
    g = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / (size - 1)
        g.putpixel((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return g.resize((size, size))


def main():
    bg = vertical_gradient(SZ, (255, 214, 150), (247, 150, 70)).convert("RGBA")
    bg.putalpha(rounded_mask(SZ, int(SZ * 0.22)))

    # soft inner highlight
    hi = Image.new("RGBA", (SZ, SZ), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hi)
    hd.ellipse([SZ * 0.1, -SZ * 0.35, SZ * 0.95, SZ * 0.55], fill=(255, 255, 255, 46))
    bg.alpha_composite(hi)

    cat = Image.open(os.path.join(CAT, "groom-0.png")).convert("RGBA")
    # trim the transparent margins of the frame
    bbox = cat.getbbox()
    if bbox:
        cat = cat.crop(bbox)
    target = int(SZ * 0.66)
    w = target
    h = int(cat.height * w / cat.width)
    if h > target:
        h = target
        w = int(cat.width * h / cat.height)
    cat = cat.resize((w, h), Image.LANCZOS)
    ox = (SZ - w) // 2
    oy = int(SZ * 0.90) - h  # sit the cat on a low "floor"
    # drop shadow
    sh = Image.new("RGBA", (SZ, SZ), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse(
        [ox + w * 0.12, oy + h - 40, ox + w * 0.88, oy + h + 46], fill=(80, 45, 15, 90)
    )
    bg.alpha_composite(sh)
    bg.alpha_composite(cat, (ox, oy))

    bg.save(OUT)
    print("wrote", OUT)


if __name__ == "__main__":
    main()

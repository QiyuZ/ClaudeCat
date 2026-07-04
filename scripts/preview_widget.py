#!/usr/bin/env python3
"""Compose a static preview of the four widget states (cat + 5h gauge + reset line)
so the layout can be eyeballed without launching the Tauri window. Not shipped."""
import os
from PIL import Image, ImageDraw, ImageFont

CAT = os.path.join(os.path.dirname(__file__), "..", "src", "assets", "cat")
OUT = os.path.join(os.path.dirname(__file__), "..", "preview.png")

S = 2  # supersample
W, H = 156 * S, 172 * S

STATES = [
    ("chill",   "chill-0.png", 72, "#5BB98B", "resets in 3h 40m", False),
    ("tired",   "sad-0.png",   22, "#E8913A", "resets in 1h 12m", True),
    ("weary",   "sad-2.png",    8, "#E0524A", "resets in 22m",     True),
    ("sleeping","sad-3.png",    0, "#E0524A", "Reset in 02:40",    True),
]


def font(sz):
    for name in ("segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, sz)
        except OSError:
            continue
    return ImageFont.load_default()


def panel(state, catfile, pct, color, reset, soft):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # cat, bottom-anchored in the top ~118px stage
    cat = Image.open(os.path.join(CAT, catfile)).convert("RGBA")
    cw = 124 * S
    ch = int(cat.height * cw / cat.width)
    cat = cat.resize((cw, ch), Image.LANCZOS)
    img.alpha_composite(cat, ((W - cw) // 2, 118 * S - ch))
    # gauge row
    gx0 = (W - 126 * S) // 2
    gy = 126 * S
    d.text((gx0, gy - 3 * S), "5h", font=font(10 * S), fill="#8a6a48")
    tx0 = gx0 + 20 * S
    tx1 = gx0 + 96 * S
    d.rounded_rectangle([tx0, gy, tx1, gy + 6 * S], radius=3 * S, fill=(120, 85, 50, 40))
    fillw = int((tx1 - tx0) * pct / 100)
    if fillw > 0:
        d.rounded_rectangle([tx0, gy, tx0 + fillw, gy + 6 * S], radius=3 * S, fill=color)
    d.text((tx1 + 4 * S, gy - 3 * S), f"{pct}%", font=font(10 * S), fill=color)
    # reset line
    rf = font(10 * S)
    tw = d.textlength(reset, font=rf)
    op = 120 if soft else 128
    d.text((tx1 + 4 * S - tw, gy + 12 * S), reset, font=rf, fill=(138, 106, 72, op))
    d.text((6 * S, 4 * S), state, font=font(9 * S), fill=(150, 150, 150, 160))
    return img


def main():
    gap = 18 * S
    sheet = Image.new("RGBA", (len(STATES) * W + (len(STATES) + 1) * gap, H + 2 * gap),
                      (238, 234, 228, 255))
    for i, s in enumerate(STATES):
        p = panel(*s)
        sheet.alpha_composite(p, (gap + i * (W + gap), gap))
    sheet.convert("RGB").save(OUT)
    print("wrote", OUT)


if __name__ == "__main__":
    main()

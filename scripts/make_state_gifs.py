#!/usr/bin/env python3
"""Render the README's animated state GIFs from the sliced cat frames.

Composites the real per-frame PNGs in src/assets/cat/ onto a soft, widget-like cream
card (so the GIFs look like the actual app and read well on both light and dark README
backgrounds) and writes looping GIFs to docs/. Re-run after changing the sprite art.

    pip install Pillow
    python scripts/make_state_gifs.py
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
FRAMES = ROOT / "src" / "assets" / "cat"
OUT = ROOT / "docs"

CARD = 200          # card is CARD x CARD px
RADIUS = 28
CAT_H = 168         # cat height inside the card
BG = (255, 247, 237, 255)      # warm cream, matches the widget glass
BORDER = (245, 214, 180, 255)


def card_base() -> Image.Image:
    """A rounded cream card with a hairline border and a soft bottom shadow."""
    img = Image.new("RGBA", (CARD, CARD), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # faint shadow
    d.rounded_rectangle([10, 14, CARD - 8, CARD - 6], RADIUS, fill=(150, 110, 70, 40))
    d.rounded_rectangle([8, 8, CARD - 8, CARD - 10], RADIUS, fill=BG, outline=BORDER, width=2)
    return img


def load(name: str) -> Image.Image:
    im = Image.open(FRAMES / name).convert("RGBA")
    w, h = im.size
    scale = CAT_H / h
    return im.resize((round(w * scale), CAT_H), Image.LANCZOS)


def compose(frame: Image.Image, dy: int = 0) -> Image.Image:
    base = card_base()
    x = (CARD - frame.width) // 2
    y = CARD - 18 - frame.height + dy
    base.alpha_composite(frame, (x, y))
    # GIF has no alpha — flatten onto white so edges stay clean.
    flat = Image.new("RGB", (CARD, CARD), (255, 255, 255))
    flat.paste(base, (0, 0), base)
    return flat


def save_gif(path: Path, frames: list[Image.Image], durations: list[int]) -> None:
    frames[0].save(
        path, save_all=True, append_images=frames[1:], duration=durations,
        loop=0, optimize=True, disposal=2,
    )
    print(f"  {path.relative_to(ROOT)}  ({len(frames)} frames)")


def anim_cycle(names: list[str], per_ms: int) -> None:
    """A looping cycle through distinct frames (grooming, typing)."""
    return [compose(load(n)) for n in names], [per_ms] * len(names)


def anim_breathe(name: str) -> None:
    """A gentle vertical breathe for the single-frame resting moods."""
    frame = load(name)
    frames, durs = [], []
    steps = 16
    for i in range(steps):
        dy = round(2.5 * math.sin(2 * math.pi * i / steps))
        frames.append(compose(frame, dy=dy))
        durs.append(90)
    return frames, durs


def main() -> None:
    OUT.mkdir(exist_ok=True)
    print("Rendering state GIFs -> docs/")
    jobs = {
        "relaxed.gif": anim_cycle(["groom-0.png", "groom-1.png", "groom-2.png", "groom-1.png"], 320),
        "typing.gif": anim_cycle(["typing-0.png", "typing-1.png", "typing-2.png", "typing-3.png"], 190),
        "tired.gif": anim_breathe("sad-0.png"),
        "weary.gif": anim_breathe("sad-2.png"),
        "sleeping.gif": anim_breathe("sad-3.png"),
    }
    for name, (frames, durs) in jobs.items():
        save_gif(OUT / name, frames, durs)
    print("Done.")


if __name__ == "__main__":
    main()

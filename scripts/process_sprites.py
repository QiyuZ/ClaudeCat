#!/usr/bin/env python3
"""
Turn the raw cat sprite strips in src/pic/ into clean, transparent, per-frame PNGs
under src/assets/cat/. Each source is a horizontal strip of 4 animation frames on a
white background. We:

  1. knock the white background out to transparent (with a soft anti-aliased edge),
  2. auto-detect the 4 frame boundaries by finding vertical gaps of empty columns,
  3. trim each frame to its content and center it on a uniform square canvas,
  4. export <state>-0.png .. <state>-3.png plus a downscaled version for the widget.

Run:  python scripts/process_sprites.py
"""
import os
from PIL import Image
import numpy as np

SRC = os.path.join(os.path.dirname(__file__), "..", "src", "pic")
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "assets", "cat")

# state name -> source filename
SHEETS = {
    "chill": "chill cat.png",
    "sad": "sad cat.png",
    "typing": "typing cat.png",
    "groom": "lick hand cat.png",
}

WHITE_CUTOFF = 244   # min channel value above which a pixel starts fading to transparent
FRAME_PAD = 14       # transparent padding around trimmed content, in output px
OUT_SIZE = 320       # square canvas edge for each exported frame


def to_alpha(img: Image.Image) -> np.ndarray:
    """RGBA float array with white background turned transparent.

    The lightest real cat pixel (cream belly) sits around min-channel 224, so a cutoff
    near 244 knocks out the paper-white background without eating the fur. A hard floor
    kills the faint near-white speckle that would otherwise blur the frame gaps.
    """
    arr = np.asarray(img.convert("RGBA")).astype(np.float32)
    rgb = arr[..., :3]
    mn = rgb.min(axis=2)
    alpha = np.clip((255 - mn) / (255 - WHITE_CUTOFF), 0.0, 1.0)
    alpha[mn >= 251] = 0.0
    alpha[alpha < 0.25] = 0.0  # drop speckle so frame gaps read as truly empty
    arr[..., 3] = alpha * 255.0
    return arr


def content_columns(arr: np.ndarray, min_strong=6) -> np.ndarray:
    """Per-column: does this column have enough *opaque* pixels to be real content?

    Counting strong (alpha>128) pixels, not just any alpha, keeps stray anti-alias
    wisps from bridging the gaps between the four frames.
    """
    strong = (arr[..., 3] > 128).sum(axis=0)
    return strong >= min_strong


def split_frames(cols: np.ndarray, want=4):
    """Segment True-runs of columns into `want` frames.

    Whiskers, tails and the sad-frame weather icons split a single cat into several
    column runs, so we (1) drop tiny noise runs, (2) glue runs across small gaps that
    clearly belong to one frame, then (3) merge the smallest remaining gaps until we
    are down to `want` frames.
    """
    n = len(cols)
    min_run = max(8, n // 100)          # a real frame spans much more than this
    min_gap = max(20, n // 45)          # gaps smaller than this are within one frame
    runs = []
    i = 0
    while i < n:
        if cols[i]:
            j = i
            while j < n and cols[j]:
                j += 1
            runs.append([i, j])
            i = j
        else:
            i += 1
    runs = [r for r in runs if (r[1] - r[0]) >= min_run]
    if not runs:
        return []
    merged = [runs[0]]
    for r in runs[1:]:
        if r[0] - merged[-1][1] <= min_gap:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    runs = merged
    while len(runs) > want:
        gaps = [(runs[k + 1][0] - runs[k][1], k) for k in range(len(runs) - 1)]
        gaps.sort()
        _, k = gaps[0]
        runs[k][1] = runs[k + 1][1]
        del runs[k + 1]
    return runs


def clean_frame(frame: np.ndarray) -> np.ndarray:
    """Erase neighbor bleed and stray specks, keeping the main cat + nearby icons.

    Equal-quarter cuts on the overlapping sheets leave slivers of the adjacent cat
    against the left/right edge. We label connected blobs, keep the biggest (the cat),
    also keep any sizeable blob that doesn't touch a side edge (e.g. the sad frame's
    rain cloud / battery icons), and clear everything else.
    """
    from scipy import ndimage

    frame = frame.copy()
    mask = frame[..., 3] > 40
    labels, n = ndimage.label(mask)
    if n <= 1:
        return frame
    areas = ndimage.sum(mask, labels, index=range(1, n + 1))
    biggest = int(np.argmax(areas)) + 1
    w = frame.shape[1]
    keep = np.zeros_like(mask)
    for lab in range(1, n + 1):
        if lab == biggest:
            keep |= labels == lab
            continue
        if areas[lab - 1] < 0.012 * areas.max():
            continue  # speck
        xs = np.where((labels == lab).any(axis=0))[0]
        touches_edge = xs[0] <= 1 or xs[-1] >= w - 2
        if not touches_edge:
            keep |= labels == lab  # a real detached element (icon), not a bleed sliver
    frame[..., 3] *= keep
    return frame


def trim_box(frame: np.ndarray):
    a = frame[..., 3] > 8
    ys = np.where(a.any(axis=1))[0]
    xs = np.where(a.any(axis=0))[0]
    if len(ys) == 0 or len(xs) == 0:
        return None
    return xs[0], ys[0], xs[-1] + 1, ys[-1] + 1


def export(state: str, arr: np.ndarray, box):
    x0, y0, x1, y1 = box
    crop = arr[y0:y1, x0:x1]
    h, w = crop.shape[:2]
    scale = (OUT_SIZE - 2 * FRAME_PAD) / max(h, w)
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    img = Image.fromarray(crop.clip(0, 255).astype(np.uint8), "RGBA").resize(
        (nw, nh), Image.LANCZOS
    )
    canvas = Image.new("RGBA", (OUT_SIZE, OUT_SIZE), (0, 0, 0, 0))
    # bottom-anchored so cats of different heights share a common "floor"
    ox = (OUT_SIZE - nw) // 2
    oy = OUT_SIZE - FRAME_PAD - nh
    canvas.paste(img, (ox, oy), img)
    return canvas


def main():
    os.makedirs(OUT, exist_ok=True)
    for state, fname in SHEETS.items():
        path = os.path.join(SRC, fname)
        img = Image.open(path)
        arr = to_alpha(img)
        cols = content_columns(arr)
        runs = split_frames(cols, want=4)
        if len(runs) != 4:
            # Overlapping cats (the landscape sheets) leave no clean gaps — fall back
            # to four equal columns and let per-frame trimming tidy the edges.
            w = arr.shape[1]
            runs = [[k * w // 4, (k + 1) * w // 4] for k in range(4)]
            print(f"{state}: {img.size} -> equal quarters")
        else:
            print(f"{state}: {img.size} -> {len(runs)} frames (gap-detected)")
        for idx, (cx0, cx1) in enumerate(runs):
            sub = clean_frame(arr[:, cx0:cx1])
            box = trim_box(sub)
            if box is None:
                continue
            canvas = export(state, sub, box)
            out = os.path.join(OUT, f"{state}-{idx}.png")
            canvas.save(out)
            print(f"    frame {idx}: cols {cx0}-{cx1} -> {out}")


if __name__ == "__main__":
    main()

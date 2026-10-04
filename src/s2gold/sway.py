"""Carry an animation's frame-to-frame motion over to a repainted first frame.

Trees in the landscape archives sway over eight frames. Repainting every frame on its
own would flicker, so only frame 0 is repainted and the other frames are derived from
it: for each original frame, block matching finds, per pixel, where in the original
frame 0 its content came from (a small displacement field). That field, scaled to the
repainted resolution and smoothed, warps the repainted frame 0 into the frame. The
motion of the leaves follows the original animation; the per-leaf detail is the
repaint's.

Also here: :func:`colour_match`, which maps a repaint's colours onto the original
sprite's colour distribution (the model tends to brighten foliage).
"""

from __future__ import annotations

import numpy as np
import numpy.typing as npt

from s2gold.formats.bitmaps import DecodedSprite

Image4 = npt.NDArray[np.float64]

SEARCH = 3  # largest displacement tried, in original pixels
PATCH = 1  # half-size of the matched patch (3x3)
DISTANCE_COST = 20  # bias towards small displacements when matches tie


def _rgba(sprite: DecodedSprite) -> Image4:
    return np.frombuffer(sprite.rgba, dtype=np.uint8).reshape(sprite.height, sprite.width, 4).astype(np.float64)


def anchored(sprite: DecodedSprite, size: tuple[int, int], anchor: tuple[int, int]) -> Image4:
    """The sprite placed on a transparent canvas with its anchor at ``anchor``."""
    w, h = size
    canvas = np.zeros((h, w, 4), dtype=np.float64)
    x0, y0 = anchor[0] - sprite.nx, anchor[1] - sprite.ny
    canvas[y0 : y0 + sprite.height, x0 : x0 + sprite.width] = _rgba(sprite)
    return canvas


def shared_canvas(sprites: list[DecodedSprite]) -> tuple[tuple[int, int], tuple[int, int]]:
    """Canvas size and anchor that hold every sprite with their anchors aligned."""
    left = max(s.nx for s in sprites)
    top = max(s.ny for s in sprites)
    right = max(s.width - s.nx for s in sprites)
    bottom = max(s.height - s.ny for s in sprites)
    return (left + right, top + bottom), (left, top)


def displacement(frame0: Image4, frame: Image4) -> tuple[npt.NDArray[np.int64], npt.NDArray[np.int64]]:
    """Per pixel of ``frame``, the (dy, dx) into ``frame0`` with the best-matching patch."""
    h, w, _ = frame0.shape
    pad = SEARCH + PATCH
    src = np.pad(frame0, ((pad, pad), (pad, pad), (0, 0)))
    dst = np.pad(frame, ((PATCH, PATCH), (PATCH, PATCH), (0, 0)))
    best = np.full((h, w), np.inf)
    dy = np.zeros((h, w), dtype=np.int64)
    dx = np.zeros((h, w), dtype=np.int64)
    side = 2 * PATCH + 1
    for oy in range(-SEARCH, SEARCH + 1):
        for ox in range(-SEARCH, SEARCH + 1):
            shifted = src[pad + oy - PATCH : pad + oy + PATCH + h, pad + ox - PATCH : pad + ox + PATCH + w]
            cost = np.abs(shifted - dst).sum(axis=2)
            total = np.full((h, w), float((abs(oy) + abs(ox)) * DISTANCE_COST))
            for py in range(side):
                for px in range(side):
                    total += cost[py : py + h, px : px + w]
            better = total < best
            best[better] = total[better]
            dy[better] = oy
            dx[better] = ox
    return dy, dx


def _box_blur(a: Image4, radius: int = 1) -> Image4:
    padded = np.pad(a, radius, mode="edge")
    side = 2 * radius + 1
    out = np.zeros(a.shape, dtype=np.float64)
    for y in range(side):
        for x in range(side):
            out += padded[y : y + a.shape[0], x : x + a.shape[1]]
    return out / (side * side)


def upscale_field(field: npt.NDArray[np.int64], scale: int) -> Image4:
    """A displacement field at ``scale`` times the resolution, in scaled units, smoothed."""
    big = np.repeat(np.repeat(field.astype(np.float64) * scale, scale, axis=0), scale, axis=1)
    return _box_blur(big, 1)


def sample(image: Image4, sy: Image4, sx: Image4) -> Image4:
    """Bilinear lookup of an RGBA image at fractional coordinates (premultiplied)."""
    h, w, _ = image.shape
    pm = image.copy()
    pm[..., :3] *= pm[..., 3:4] / 255.0
    y0 = np.clip(np.floor(sy).astype(np.int64), 0, h - 1)
    x0 = np.clip(np.floor(sx).astype(np.int64), 0, w - 1)
    y1 = np.clip(y0 + 1, 0, h - 1)
    x1 = np.clip(x0 + 1, 0, w - 1)
    fy = (sy - np.floor(sy))[..., None]
    fx = (sx - np.floor(sx))[..., None]
    v = (
        pm[y0, x0] * (1 - fy) * (1 - fx)
        + pm[y0, x1] * (1 - fy) * fx
        + pm[y1, x0] * fy * (1 - fx)
        + pm[y1, x1] * fy * fx
    )
    alpha = v[..., 3:4]
    rgb = np.where(alpha > 0, v[..., :3] * 255.0 / np.maximum(alpha, 1e-6), 0.0)
    out: Image4 = np.clip(np.concatenate([rgb, alpha], axis=2), 0, 255)
    return out


def colour_match(image: Image4, reference: Image4) -> Image4:
    """Map the opaque pixels' colours, per channel, onto the reference's distribution."""
    out = image.copy()
    mine = image[..., 3] > 128
    theirs = reference[..., 3] > 128
    if not mine.any() or not theirs.any():
        return out
    for c in range(3):
        values = out[..., c][mine]
        target = np.sort(reference[..., c][theirs])
        ranks = np.argsort(np.argsort(values)) / max(1, len(values) - 1)
        channel = out[..., c]
        channel[mine] = np.interp(ranks, np.linspace(0.0, 1.0, len(target)), target)
    return out


def derive_frames(originals: list[DecodedSprite], repainted0: DecodedSprite, scale: int) -> list[DecodedSprite]:
    """Frames 1.. of an animation, made by warping the repainted frame 0.

    Args:
        originals: The original frames, frame 0 first.
        repainted0: Frame 0 repainted at ``scale`` times the original size, with its
            anchor already scaled.
        scale: Repaint scale.

    Returns:
        One sprite per original frame after the first, each at ``scale`` times its
        original size and anchor.
    """
    (cw, ch), (ax, ay) = shared_canvas(originals)
    base = anchored(originals[0], (cw, ch), (ax, ay))
    painted = anchored(repainted0, (cw * scale, ch * scale), (ax * scale, ay * scale))
    yy, xx = np.mgrid[0 : ch * scale, 0 : cw * scale].astype(np.float64)
    out: list[DecodedSprite] = []
    for frame in originals[1:]:
        dy, dx = displacement(base, anchored(frame, (cw, ch), (ax, ay)))
        warped = sample(painted, yy + upscale_field(dy, scale), xx + upscale_field(dx, scale))
        x0, y0 = (ax - frame.nx) * scale, (ay - frame.ny) * scale
        crop = warped[y0 : y0 + frame.height * scale, x0 : x0 + frame.width * scale]
        out.append(
            DecodedSprite(
                width=frame.width * scale,
                height=frame.height * scale,
                nx=frame.nx * scale,
                ny=frame.ny * scale,
                kind=frame.kind,
                rgba=np.round(crop).astype(np.uint8).tobytes(),
                player_mask=None,
                player_indices=(),
            )
        )
    return out

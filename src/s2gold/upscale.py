"""MMPX 2x pixel-art magnification for sprites and palette-indexed terrain.

MMPX ("Style-Preserving Pixel Art Magnification", Morgan McGuire and Mara Gagiu,
Journal of Computer Graphics Techniques 10(2), 2021, reference code under the MIT
licence) maps every source pixel ``E`` to four destination pixels ``J K / L M`` by
matching rules over its neighbourhood::

            P
        A   B   C
    Q   D   E   F   R
        G   H   I
            S

Every destination pixel is a *copy* of a source pixel. Nothing is blended, so the
filter preserves the palette exactly. That is what makes it safe here. The rules run
on integer *keys* rather than colours: a sprite key packs the RGBA colour together
with the player-colour shade, and a terrain key is the raw palette index. Player
masks, semi-transparent shadows, gouraud lighting and palette-cycled water
therefore all survive the magnification unchanged.

The rule set below follows the paper's listing (1:1 edges, intersections, triangle
tips, 2:1 edges, applied in that order with later rules overriding earlier ones),
vectorised with numpy over whole images.
"""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import numpy.typing as npt

from s2gold.formats.bitmaps import DecodedSprite

Keys = npt.NDArray[np.int64]

SCALE = 2
_PAD = 3


def mmpx2(keys: Keys, luma: Keys, border: int | None = 0, border_luma: int = 256) -> Keys:
    """Magnify a 2D key image 2x with MMPX.

    Args:
        keys: ``(h, w)`` integer keys; equal keys mean "same pixel value".
        luma: ``(h, w)`` brightness of each key, lower meaning darker or more opaque.
            MMPX treats the darker side of an ambiguous edge as the foreground.
        border: Key used for pixels outside the image (transparent for sprites), or
            ``None`` to clamp reads to the nearest edge pixel.
        border_luma: Brightness of ``border`` when it is used.

    Returns:
        The ``(2h, 2w)`` magnified key image.
    """
    h, w = keys.shape
    if h == 0 or w == 0:
        return np.zeros((h * SCALE, w * SCALE), dtype=np.int64)
    if border is None:
        pk = np.pad(keys.astype(np.int64), _PAD, mode="edge")
        pl = np.pad(luma.astype(np.int64), _PAD, mode="edge")
    else:
        pk = np.pad(keys.astype(np.int64), _PAD, mode="constant", constant_values=border)
        pl = np.pad(luma.astype(np.int64), _PAD, mode="constant", constant_values=border_luma)

    def src(dx: int, dy: int) -> Keys:
        return pk[_PAD + dy : _PAD + dy + h, _PAD + dx : _PAD + dx + w]

    def lum(dx: int, dy: int) -> Keys:
        return pl[_PAD + dy : _PAD + dy + h, _PAD + dx : _PAD + dx + w]

    a, b, c = src(-1, -1), src(0, -1), src(1, -1)
    d, e, f = src(-1, 0), src(0, 0), src(1, 0)
    g, hh, i = src(-1, 1), src(0, 1), src(1, 1)
    p, s, q, r = src(0, -2), src(0, 2), src(-2, 0), src(2, 0)
    bl, dl, el, fl, hl = lum(0, -1), lum(-1, 0), lum(0, 0), lum(1, 0), lum(0, 1)

    def eq_all(x: Keys, *ys: Keys) -> npt.NDArray[np.bool_]:
        out = np.ones(x.shape, dtype=bool)
        for y in ys:
            out &= x == y
        return out

    def eq_any(x: Keys, *ys: Keys) -> npt.NDArray[np.bool_]:
        out = np.zeros(x.shape, dtype=bool)
        for y in ys:
            out |= x == y
        return out

    def eq_none(x: Keys, *ys: Keys) -> npt.NDArray[np.bool_]:
        return ~eq_any(x, *ys)

    # Uniform neighbourhoods have no features: Nearest is already correct there.
    active = ~eq_all(e, a, b, c, d, f, g, hh, i)

    jj, kk, ll, mm = e.copy(), e.copy(), e.copy(), e.copy()

    def put(dst: Keys, cond: npt.NDArray[np.bool_], value: Keys) -> None:
        np.copyto(dst, value, where=cond & active)

    # 1:1 slope edges, extended from EPX.
    put(jj, (d == b) & (d != hh) & (d != f) & ((el >= dl) | (e == a)) & eq_any(e, a, c, g)
        & ((el < dl) | (a != d) | (e != p) | (e != q)), d)  # fmt: skip
    put(kk, (b == f) & (b != d) & (b != hh) & ((el >= bl) | (e == c)) & eq_any(e, a, c, i)
        & ((el < bl) | (c != b) | (e != p) | (e != r)), b)  # fmt: skip
    put(ll, (hh == d) & (hh != f) & (hh != b) & ((el >= hl) | (e == g)) & eq_any(e, a, g, i)
        & ((el < hl) | (g != hh) | (e != s) | (e != q)), hh)  # fmt: skip
    put(mm, (f == hh) & (f != b) & (f != d) & ((el >= fl) | (e == i)) & eq_any(e, c, g, i)
        & ((el < fl) | (i != hh) | (e != r) | (e != s)), f)  # fmt: skip

    # Intersections: reconnect diagonal corners the 1:1 rules left apart, but not at
    # the edge of a checkerboard dither (the far pixel breaks that symmetry).
    cond = (e != f) & eq_all(e, c, i, d, q) & eq_all(f, b, hh) & (f != src(3, 0))
    put(kk, cond, f)
    put(mm, cond, f)
    cond = (e != d) & eq_all(e, a, g, f, r) & eq_all(d, b, hh) & (d != src(-3, 0))
    put(jj, cond, d)
    put(ll, cond, d)
    cond = (e != hh) & eq_all(e, g, i, b, p) & eq_all(hh, d, f) & (hh != src(0, 3))
    put(ll, cond, hh)
    put(mm, cond, hh)
    cond = (e != b) & eq_all(e, a, c, hh, s) & eq_all(b, d, f) & (b != src(0, -3))
    put(jj, cond, b)
    put(kk, cond, b)

    # Triangle tips: restore the corner the luminance tie-break flattened.
    cond = (bl < el) & eq_all(e, g, hh, i, s) & eq_none(e, a, d, c, f)
    put(jj, cond, b)
    put(kk, cond, b)
    cond = (hl < el) & eq_all(e, a, b, c, p) & eq_none(e, d, g, i, f)
    put(ll, cond, hh)
    put(mm, cond, hh)
    cond = (fl < el) & eq_all(e, a, d, g, q) & eq_none(e, b, c, i, hh)
    put(kk, cond, f)
    put(mm, cond, f)
    cond = (dl < el) & eq_all(e, c, f, i, r) & eq_none(e, b, a, g, hh)
    put(jj, cond, d)
    put(ll, cond, d)

    # 2:1 edges: extend an already-refined destination pixel one step further.
    h_ne_b = hh != b
    lower = h_ne_b & (hh != a) & (hh != e) & (hh != c)
    put(ll, lower & eq_all(hh, g, f, r) & eq_none(hh, d, src(2, -1)), mm)
    put(mm, lower & eq_all(hh, i, d, q) & eq_none(hh, f, src(-2, -1)), ll)
    upper = h_ne_b & (b != i) & (b != g) & (b != e)
    put(jj, upper & eq_all(b, a, f, r) & eq_none(b, d, src(2, 1)), kk)
    put(kk, upper & eq_all(b, c, d, q) & eq_none(b, f, src(-2, 1)), jj)
    f_ne_d = f != d
    left = f_ne_d & (d != i) & (d != e) & (d != c)
    put(jj, left & eq_all(d, a, hh, s) & eq_none(d, b, src(1, 2)), ll)
    put(ll, left & eq_all(d, g, b, p) & eq_none(d, hh, src(1, -2)), jj)
    right = f_ne_d & (f != e) & (f != a) & (f != g)
    put(kk, right & eq_all(f, c, hh, s) & eq_none(f, b, src(-1, 2)), mm)
    put(mm, right & eq_all(f, i, b, p) & eq_none(f, hh, src(-1, -2)), kk)

    out = np.empty((h * SCALE, w * SCALE), dtype=np.int64)
    out[0::2, 0::2] = jj
    out[0::2, 1::2] = kk
    out[1::2, 0::2] = ll
    out[1::2, 1::2] = mm
    return out


def upscale_sprite(sprite: DecodedSprite) -> DecodedSprite:
    """Return the sprite magnified 2x with MMPX, anchor and player mask included.

    The colour and the player-colour shade are filtered together as one key, so the
    magnified player mask lines up with the magnified colour pixel for pixel. Pixels
    outside the sprite count as transparent, which keeps every sprite independent of
    its atlas neighbours.
    """
    w, h = sprite.width, sprite.height
    if w == 0 or h == 0 or not sprite.rgba:
        return replace(sprite, width=w * SCALE, height=h * SCALE, nx=sprite.nx * SCALE, ny=sprite.ny * SCALE)
    rgba = np.frombuffer(sprite.rgba, dtype=np.uint8).reshape(h, w, 4).astype(np.int64)
    if sprite.player_mask is not None:
        mask = np.frombuffer(sprite.player_mask, dtype=np.uint8).reshape(h, w).astype(np.int64)
    else:
        mask = np.zeros((h, w), dtype=np.int64)
    r, g, b, a = rgba[..., 0], rgba[..., 1], rgba[..., 2], rgba[..., 3]
    keys = (r << 32) | (g << 24) | (b << 16) | (a << 8) | mask
    luma = (r + g + b + 1) * (256 - a)
    big = mmpx2(keys, luma, border=0, border_luma=256)
    out = np.empty((h * SCALE, w * SCALE, 4), dtype=np.uint8)
    out[..., 0] = (big >> 32) & 0xFF
    out[..., 1] = (big >> 24) & 0xFF
    out[..., 2] = (big >> 16) & 0xFF
    out[..., 3] = (big >> 8) & 0xFF
    player_mask = (big & 0xFF).astype(np.uint8).tobytes() if sprite.player_mask is not None else None
    return replace(
        sprite,
        width=w * SCALE,
        height=h * SCALE,
        nx=sprite.nx * SCALE,
        ny=sprite.ny * SCALE,
        rgba=out.tobytes(),
        player_mask=player_mask,
    )


def palette_luma(colors: list[tuple[int, int, int]] | tuple[tuple[int, int, int], ...]) -> Keys:
    """Brightness of each palette entry, in the scale :func:`mmpx2` expects."""
    lut = np.zeros(256, dtype=np.int64)
    for idx, (r, g, b) in enumerate(colors[:256]):
        lut[idx] = (r + g + b + 1) * 256
    return lut


def upscale_indexed(
    indices: npt.NDArray[np.uint8],
    colors: list[tuple[int, int, int]] | tuple[tuple[int, int, int], ...],
    regions: list[tuple[int, int, int, int]] | tuple[tuple[int, int, int, int], ...] = (),
) -> npt.NDArray[np.uint8]:
    """Magnify a palette-index image 2x with MMPX; output holds only input indices.

    Args:
        indices: ``(h, w)`` palette indices.
        colors: The palette, used only to rank brightness.
        regions: ``(x, y, w, h)`` rectangles filtered on their own with edges clamped,
            so a texture never borrows pixels from a neighbouring texture in the
            sheet. Regions are applied in order over a whole-image pass.

    Returns:
        The ``(2h, 2w)`` magnified indices.
    """
    lut = palette_luma(colors)
    keys = indices.astype(np.int64)
    out = mmpx2(keys, lut[keys], border=None)
    for x, y, w, h in regions:
        sub = keys[y : y + h, x : x + w]
        out[y * SCALE : (y + h) * SCALE, x * SCALE : (x + w) * SCALE] = mmpx2(sub, lut[sub], border=None)
    return out.astype(np.uint8)

import numpy as np

from s2gold.formats.bitmaps import DecodedSprite
from s2gold.sway import colour_match, derive_frames, displacement
from s2gold.upscale import upscale_sprite


def _texture(h: int, w: int, seed: int = 3) -> np.ndarray:
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 4), dtype=np.float64)
    img[..., :3] = rng.integers(0, 255, size=(h, w, 3))
    img[..., 3] = 255
    return img


def _sprite(img: np.ndarray, nx: int, ny: int) -> DecodedSprite:
    h, w, _ = img.shape
    return DecodedSprite(w, h, nx, ny, "rle", img.astype(np.uint8).tobytes(), None, ())


def test_displacement_finds_a_known_shift() -> None:
    base = _texture(20, 20)
    moved = np.roll(base, 2, axis=1)  # content moved right by 2
    dy, dx = displacement(base, moved)
    inner = (slice(4, -4), slice(4, -4))
    assert (dy[inner] == 0).all()
    assert (dx[inner] == -2).all()


def test_derived_frame_follows_the_original_motion() -> None:
    base = _texture(16, 16)
    frame0 = _sprite(base, 8, 15)
    frame1 = _sprite(np.roll(base, 1, axis=0), 8, 15)  # content moved down by 1
    repainted = upscale_sprite(frame0)
    (derived,) = derive_frames([frame0, frame1], repainted, 2)
    assert (derived.width, derived.height, derived.nx, derived.ny) == (32, 32, 16, 30)
    got = np.frombuffer(derived.rgba, dtype=np.uint8).reshape(32, 32, 4).astype(int)
    want = np.frombuffer(upscale_sprite(frame1).rgba, dtype=np.uint8).reshape(32, 32, 4).astype(int)
    inner = (slice(8, -8), slice(8, -8))
    assert np.abs(got[inner] - want[inner]).mean() < 25


def test_colour_match_pulls_colours_onto_the_reference() -> None:
    bright = np.zeros((10, 10, 4))
    bright[..., 1] = np.linspace(150, 250, 100).reshape(10, 10)
    bright[..., 3] = 255
    dark = bright.copy()
    dark[..., 1] = np.linspace(40, 120, 100).reshape(10, 10)
    out = colour_match(bright, dark)
    assert abs(out[..., 1].mean() - dark[..., 1].mean()) < 1
    # Order is kept: brighter stays brighter.
    assert out[0, 0, 1] < out[9, 9, 1]

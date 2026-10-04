import numpy as np

from s2gold.formats.bitmaps import SHADOW_ALPHA, DecodedSprite
from s2gold.upscale import mmpx2, upscale_indexed, upscale_sprite

BLACK = 0
WHITE = 1
LUMA = np.array([1 * 256, 766 * 256], dtype=np.int64)


def run(img: list[list[int]]) -> np.ndarray:
    keys = np.array(img, dtype=np.int64)
    return mmpx2(keys, LUMA[keys], border=None)


def test_uniform_image_is_nearest() -> None:
    out = run([[WHITE] * 4 for _ in range(3)])
    assert out.shape == (6, 8)
    assert (out == WHITE).all()


def test_isolated_pixel_stays_a_block() -> None:
    img = [[WHITE] * 5 for _ in range(5)]
    img[2][2] = BLACK
    out = run(img)
    expected = np.full((10, 10), WHITE)
    expected[4:6, 4:6] = BLACK
    assert (out == expected).all()


def test_checkerboard_is_preserved_as_nearest() -> None:
    img = [[(x + y) % 2 for x in range(8)] for y in range(8)]
    out = run(img)
    nearest = np.kron(np.array(img), np.ones((2, 2), dtype=np.int64))
    # Clamped image corners form real corner shapes; the dither interior must not change.
    assert (out[2:-2, 2:-2] == nearest[2:-2, 2:-2]).all()


def test_diagonal_line_is_smoothed_on_one_side_only() -> None:
    img = [[WHITE] * 7 for _ in range(7)]
    for k in range(7):
        img[k][k] = BLACK
    out = run(img)
    # The white pixel right of the line gains a black bottom-left corner, which
    # turns the 2x2 stair steps into a continuous 1:1 diagonal.
    assert out[3 * 2 + 1, 4 * 2] == BLACK
    # The dark line keeps its own pixels (it is the foreground), so it only grows.
    for k in range(1, 6):
        assert (out[2 * k : 2 * k + 2, 2 * k : 2 * k + 2] == BLACK).all()
    # A thin dark line is refined from both sides alike: the band is symmetric.
    assert (out[2:-2, 2:-2] == out[2:-2, 2:-2].T).all()


def test_output_keys_are_a_subset_of_input_keys() -> None:
    rng = np.random.default_rng(7)
    keys = rng.integers(0, 6, size=(23, 31)).astype(np.int64)
    luma = keys * 100
    out = mmpx2(keys, luma, border=0)
    assert set(np.unique(out)) <= set(np.unique(keys)) | {0}


def _sprite(w: int, h: int, pixels: dict[tuple[int, int], tuple[tuple[int, int, int, int], int]]) -> DecodedSprite:
    rgba = bytearray(w * h * 4)
    mask = bytearray(w * h)
    for (x, y), (color, shade) in pixels.items():
        o = (y * w + x) * 4
        rgba[o : o + 4] = bytes(color)
        mask[y * w + x] = shade
    return DecodedSprite(w, h, 5, 7, "player", bytes(rgba), bytes(mask), (128, 129, 130, 131))


def test_sprite_keeps_mask_aligned_with_colour() -> None:
    pixels = {}
    for y in range(6):
        for x in range(6):
            if x + y < 7:
                shade = 1 + (x % 4) if y < 3 else 0
                pixels[(x, y)] = ((40 + 10 * x, 30, 20 * y, 255), shade)
    sprite = _sprite(6, 6, pixels)
    big = upscale_sprite(sprite)
    assert (big.width, big.height, big.nx, big.ny) == (12, 12, 10, 14)
    assert big.player_mask is not None
    src = {
        (sprite.rgba[i * 4 : i * 4 + 4], sprite.player_mask[i])  # type: ignore[index]
        for i in range(36)
    }
    out = {(big.rgba[i * 4 : i * 4 + 4], big.player_mask[i]) for i in range(144)}
    assert out <= src


def test_shadow_pixels_stay_semi_transparent_black() -> None:
    rgba = bytearray(8 * 8 * 4)
    for y in range(8):
        for x in range(8):
            if y > x:
                rgba[(y * 8 + x) * 4 + 3] = SHADOW_ALPHA
    sprite = DecodedSprite(8, 8, 0, 0, "shadow", bytes(rgba), None, ())
    big = upscale_sprite(sprite)
    arr = np.frombuffer(big.rgba, dtype=np.uint8).reshape(16, 16, 4)
    assert set(np.unique(arr[..., 3])) == {0, SHADOW_ALPHA}
    assert (arr[..., :3] == 0).all()
    assert big.player_mask is None


def test_empty_sprite_only_scales_metadata() -> None:
    sprite = DecodedSprite(0, 0, 3, 4, "rle", b"", None, ())
    big = upscale_sprite(sprite)
    assert (big.width, big.height, big.nx, big.ny, big.rgba) == (0, 0, 6, 8, b"")


def test_indexed_regions_never_borrow_from_neighbours() -> None:
    colors = [(i, i, i) for i in range(256)]
    img = np.full((8, 16), 9, dtype=np.uint8)
    img[:, 8:] = 200
    img[2:6, 2:6] = 50
    out = upscale_indexed(img, colors, regions=[(0, 0, 8, 8)])
    assert out.shape == (16, 32)
    assert set(np.unique(out)) <= {9, 50, 200}
    assert set(np.unique(out[:, :16])) <= {9, 50}

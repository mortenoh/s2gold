import numpy as np
from PIL import Image

from s2gold.formats.bitmaps import DecodedSprite
from s2gold.remaster import MAGENTA, REF_SIZE, cut_out, fit, reference_image


def _sprite(w: int, h: int, box: tuple[int, int, int, int]) -> DecodedSprite:
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    x0, y0, x1, y1 = box
    rgba[y0:y1, x0:x1] = (200, 150, 100, 255)
    return DecodedSprite(w, h, 7, 9, "rle", rgba.tobytes(), None, ())


def test_reference_centres_the_sprite_on_magenta() -> None:
    ref = np.asarray(reference_image(_sprite(40, 20, (0, 0, 40, 20))))
    assert ref.shape == (REF_SIZE, REF_SIZE, 3)
    assert tuple(ref[0, 0]) == MAGENTA
    assert tuple(ref[REF_SIZE // 2, REF_SIZE // 2]) == (200, 150, 100)


def test_cut_out_keys_magenta_and_keeps_other_colours() -> None:
    img = np.zeros((4, 4, 3), dtype=np.uint8)
    img[:] = MAGENTA
    img[1, 1] = (200, 30, 40)  # a red roof is not magenta
    img[2, 2] = (128, 0, 128)  # a dark magenta shadow is backdrop too
    out = cut_out(Image.fromarray(img, "RGB"))
    assert out[0, 0, 3] == 0
    assert out[2, 2, 3] == 0
    assert out[1, 1, 3] == 255
    assert tuple(out[1, 1, :3]) == (200, 30, 40)


def test_fit_maps_the_cut_out_onto_the_doubled_original_outline() -> None:
    original = _sprite(30, 20, (5, 4, 25, 18))
    gen = np.zeros((512, 512, 3), dtype=np.uint8)
    gen[:] = MAGENTA
    gen[100:380, 60:460] = (90, 90, 90)
    fitted = fit(Image.fromarray(gen, "RGB"), original)
    assert fitted is not None
    assert (fitted.width, fitted.height, fitted.nx, fitted.ny) == (60, 40, 14, 18)
    alpha = np.frombuffer(fitted.rgba, dtype=np.uint8).reshape(40, 60, 4)[..., 3]
    ys, xs = np.nonzero(alpha > 128)
    assert (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1) == (10, 8, 50, 36)


def test_fit_gives_up_on_an_empty_result() -> None:
    gen = np.zeros((64, 64, 3), dtype=np.uint8)
    gen[:] = MAGENTA
    assert fit(Image.fromarray(gen, "RGB"), _sprite(10, 10, (0, 0, 10, 10))) is None


def test_object_selection_skips_shadows_tiny_sprites_and_trees() -> None:
    from s2gold.remaster import object_indices

    decoded = [
        (200, _sprite(40, 60, (0, 0, 40, 60))),  # a tree frame: animated, not selected
        (500, _sprite(6, 5, (0, 0, 6, 5))),  # a few dots
        (506, _sprite(47, 41, (0, 0, 47, 41))),
        (516, _sprite(39, 16, (0, 0, 39, 16))),
        (520, DecodedSprite(75, 40, 0, 0, "shadow", bytes(75 * 40 * 4), None, ())),
    ]
    assert object_indices(decoded) == [506, 516]

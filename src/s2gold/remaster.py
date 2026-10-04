"""AI remaster of world sprites: export references, fit generated art, pack an ``ai2`` set.

The generation itself runs elsewhere (``scripts/remaster-gen.sh`` drives an image-editing
model such as Qwen Image 2.1 on a GPU host). This module covers the two local ends:

1. :func:`prepare` writes one reference image per selected sprite: the original pixels
   scaled up by a whole factor and centred on a flat magenta backdrop, which the model is
   asked to keep so the result can be cut out cleanly.
2. :func:`pack` reads the generated images, cuts each sprite out of the magenta backdrop,
   scales its outline onto the original sprite's outline at 2x, and writes
   ``graphics/<archive>/ai2/`` with the same layout as the MMPX ``hd2`` set. Sprites
   without a generated image (shadows, flags, construction sites) keep their MMPX version,
   so the set is always complete.

Generated images are derived from the game's art, so they live under the gitignored
``remaster/`` directory next to ``extracted/`` and are never committed.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import numpy.typing as npt
from PIL import Image

from s2gold.convert.graphics import (
    STANDARD_PALETTE,
    _sprite_entries,
    archive_path,
    decode_archive,
    pack_sprites,
)
from s2gold.core import REPO_ROOT, Manifest, write_json
from s2gold.formats.bitmaps import DecodedSprite
from s2gold.formats.palette import Palette
from s2gold.upscale import SCALE, upscale_sprite

REMASTER_DIR = REPO_ROOT / "remaster"
AI_DIR = f"ai{SCALE}"
REF_SIZE = 1024
REF_FILL = 800
MAGENTA = (255, 0, 255)

# Finished building sprites of a nation set: 250 + 5 * id (the +1 shadow, +2/+3
# construction site and +4 door slots stay MMPX).
BUILDING_BASE = 250
BUILDING_STRIDE = 5
BUILDING_IDS = range(40)


def building_indices(decoded: list[tuple[int, DecodedSprite]]) -> list[int]:
    """Finished-building sprite indices present in a nation archive."""
    present = {i for i, s in decoded if s.width and s.height and s.kind != "shadow"}
    return [BUILDING_BASE + BUILDING_STRIDE * b for b in BUILDING_IDS if BUILDING_BASE + BUILDING_STRIDE * b in present]


def _rgba(sprite: DecodedSprite) -> npt.NDArray[np.uint8]:
    return np.frombuffer(sprite.rgba, dtype=np.uint8).reshape(sprite.height, sprite.width, 4)


def reference_image(sprite: DecodedSprite) -> Image.Image:
    """The sprite scaled by a whole factor and centred on a magenta square."""
    tile = Image.frombytes("RGBA", (sprite.width, sprite.height), sprite.rgba)
    k = max(1, REF_FILL // max(sprite.width, sprite.height))
    big = tile.resize((sprite.width * k, sprite.height * k), Image.Resampling.NEAREST)
    canvas = Image.new("RGBA", (REF_SIZE, REF_SIZE), (*MAGENTA, 255))
    canvas.alpha_composite(big, ((REF_SIZE - big.width) // 2, (REF_SIZE - big.height) // 2))
    return canvas.convert("RGB")


# Static landscape objects of a MAPBOBS archive: nature decorations 500..515 and the
# two granite types in six sizes each, 516..527 (their shadows at 600+ stay MMPX).
# Trees (200 + 15 * species) sway over eight frames and are not included.
OBJECT_INDICES = range(500, 528)

SELECTIONS = ("buildings", "objects")

# Below this size (largest side, original pixels) a sprite is a few dots: the model
# would invent the object rather than redraw it, so it keeps its MMPX version.
MIN_OBJECT_SIZE = 20


def object_indices(decoded: list[tuple[int, DecodedSprite]]) -> list[int]:
    """Static decoration and granite sprite indices present in a landscape archive."""
    present = {i for i, s in decoded if max(s.width, s.height) >= MIN_OBJECT_SIZE and s.kind != "shadow"}
    return [i for i in OBJECT_INDICES if i in present]


def prepare(extracted: Path, archive: str, selection: str = "buildings", out_root: Path = REMASTER_DIR) -> list[int]:
    """Write reference images for a selection of sprites to ``<out_root>/<archive>/ref``.

    Args:
        extracted: innoextract output root.
        archive: Graphics archive name.
        selection: ``buildings`` (finished buildings of a nation set) or ``objects``
            (static decorations and granite of a landscape set).
        out_root: Remaster working directory.

    Returns:
        The sprite indices exported.
    """
    if selection not in SELECTIONS:
        raise ValueError(f"unknown selection {selection!r}; expected one of {SELECTIONS}")
    decoded = _decode(extracted, archive)
    by_index = dict(decoded)
    ref_dir = out_root / archive / "ref"
    ref_dir.mkdir(parents=True, exist_ok=True)
    chosen = building_indices(decoded) if selection == "buildings" else object_indices(decoded)
    for index in chosen:
        reference_image(by_index[index]).save(ref_dir / f"{index}.png")
    write_json(out_root / archive / "jobs.json", {"archive": archive, "indices": chosen})
    return chosen


def cut_out(image: Image.Image) -> npt.NDArray[np.uint8]:
    """Key the magenta backdrop out of a generated image and remove magenta spill.

    Alpha ramps with how magenta a pixel's hue is (red and blue both above green,
    relative to its brightness), so soft edges stay soft and the backdrop's darkened
    parts, such as the ground shadow the model paints, are keyed out too: the game
    draws its own shadow sprite. The magenta part of every remaining pixel is then
    neutralised.
    """
    rgb = np.asarray(image.convert("RGB")).astype(np.int32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    spill = np.clip(np.minimum(r, b) - g, 0, None)
    ratio = spill / np.maximum(1, np.maximum(r, b))
    alpha = np.clip(1.0 - (ratio - 0.35) / 0.4, 0.0, 1.0)
    out = np.empty((*rgb.shape[:2], 4), dtype=np.uint8)
    # Only pixels with a noticeable magenta cast lose it; a red roof keeps its blue.
    despill = np.round(spill * np.clip((ratio - 0.1) / 0.3, 0.0, 1.0)).astype(np.int32)
    out[..., 0] = np.clip(r - despill, 0, 255)
    out[..., 1] = g
    out[..., 2] = np.clip(b - despill, 0, 255)
    out[..., 3] = np.round(alpha * 255).astype(np.uint8)
    return out


def _bbox(alpha: npt.NDArray[np.uint8], threshold: int) -> tuple[int, int, int, int] | None:
    ys, xs = np.nonzero(alpha > threshold)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def fit(generated: Image.Image, original: DecodedSprite) -> DecodedSprite | None:
    """Scale a generated sprite onto the original's outline at 2x.

    The cut-out's bounding box is resized onto the original's opaque bounding box
    (doubled), so the footprint, the anchor and the draw order keep lining up with the
    terrain and the other sprites. Returns None when nothing usable was generated.
    """
    cut = cut_out(generated)
    src_box = _bbox(cut[..., 3], 128)
    dst_box = _bbox(_rgba(original)[..., 3], 0)
    if src_box is None or dst_box is None:
        return None
    sx0, sy0, sx1, sy1 = src_box
    dx0, dy0, dx1, dy1 = (v * SCALE for v in dst_box)
    piece = Image.fromarray(cut[sy0:sy1, sx0:sx1], "RGBA")
    # Resize in premultiplied space so transparent pixels do not bleed colour.
    piece = piece.convert("RGBa").resize((dx1 - dx0, dy1 - dy0), Image.Resampling.LANCZOS).convert("RGBA")
    canvas = Image.new("RGBA", (original.width * SCALE, original.height * SCALE), (0, 0, 0, 0))
    canvas.paste(piece, (dx0, dy0))
    return DecodedSprite(
        width=canvas.width,
        height=canvas.height,
        nx=original.nx * SCALE,
        ny=original.ny * SCALE,
        kind=original.kind,
        rgba=canvas.tobytes(),
        player_mask=None,
        player_indices=(),
    )


def pack(extracted: Path, assets: Path, archive: str, out_root: Path = REMASTER_DIR) -> int:
    """Build ``graphics/<archive>/ai2`` from generated images plus MMPX for the rest.

    Returns:
        How many sprites came from generated images.
    """
    decoded = _decode(extracted, archive)
    gen_dir = out_root / archive / "out"
    sprites: list[tuple[int, DecodedSprite]] = []
    replaced = 0
    for index, sprite in decoded:
        path = gen_dir / f"{index}.png"
        fitted = None
        if path.exists() and sprite.player_mask is None and sprite.width and sprite.height:
            fitted = fit(Image.open(path), sprite)
        if fitted is not None:
            replaced += 1
            sprites.append((index, fitted))
        else:
            sprites.append((index, upscale_sprite(sprite)))

    out_dir = assets / "graphics" / archive / AI_DIR
    if out_dir.exists():
        for old in out_dir.glob("*.png"):
            old.unlink()
    by_key, count, has_masks = pack_sprites(sprites, out_dir, padding=2)
    write_json(
        out_dir / "atlas.json",
        {
            "archive": archive,
            "scale": SCALE,
            "atlas_count": count,
            "atlases": [f"atlas_{i}.png" for i in range(count)],
            "pmasks": [f"pmask_{i}.png" for i in range(count)] if has_masks else [],
            "remastered": replaced,
            "sprites": _sprite_entries(sprites, by_key, has_masks),
        },
    )
    manifest_path = assets / "manifest.json"
    current: dict[str, object] = {}
    if manifest_path.exists():
        cats = json.loads(manifest_path.read_text()).get("categories", {})
        current = dict(cats.get("graphics_ai", {}).get("archives", {}))
    current[archive] = f"graphics/{archive}/{AI_DIR}/atlas.json"
    manifest = Manifest()
    manifest.add("graphics_ai", {"scale": SCALE, "archives": current})
    manifest.save(assets)
    return replaced


def _decode(extracted: Path, archive: str) -> list[tuple[int, DecodedSprite]]:
    path = archive_path(extracted, archive)
    if path is None:
        raise ValueError(f"unknown graphics archive {archive!r}")
    standard = Palette.from_bbm(extracted / "GFX" / "PALETTE" / STANDARD_PALETTE)
    decoded, _ = decode_archive(path, standard)
    return decoded

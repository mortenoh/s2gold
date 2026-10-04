"""Converter: BOB settler-animation containers to PNG sprite atlases plus per-file JSON.

The ``DATA/BOBS/*.BOB`` files (``CARRIER.BOB``, ``CARRIER2.BOB``, ``JOBS.BOB``) hold the
walking-figure animations for settlers plus the tools/goods they carry. Unlike a graphics
LST, a BOB is not a flat list of sprites: it is 96 body sprites, a pile of overlay sprites,
and two composition tables that tell the renderer which body and which overlay to draw for a
given animation cell. This converter decodes every sprite (see :mod:`s2gold.formats.bob`),
packs them into the same RGBA atlas layout the graphics converter uses, and additionally
emits the two composition tables into ``atlas.json`` so the renderer can assemble figures.

Output layout under ``<assets>/bobs/<name>/``:

* ``atlas_N.png`` colour atlases (RGBA, transparent background).
* ``pmask_N.png`` player-color shade masks (BOB figures are player-colored).
* ``atlas.json`` sprite index, the body table, and the links table.
* ``hd2/`` a 2x MMPX-magnified copy for the BOBs the game draws (:data:`HD_BOBS`), with
  ``"scale": 2`` in its ``atlas.json``; the composition tables are unchanged.

Sprite keys in ``atlas.json`` share one integer space: bodies use their body index
(``body_base`` .. ``body_base + 95``) and overlays follow at ``overlay_base``. The
composition tables use the *native* indices ``formats/bob.py`` exposes (body index 0-95;
overlay index 0..num_overlays-1); add ``body_base`` / ``overlay_base`` to resolve a sprite.
"""

from __future__ import annotations

from pathlib import Path

from s2gold.atlas import Placement
from s2gold.convert.graphics import HD_DIR, STANDARD_PALETTE, pack_sprites, write_hd_set
from s2gold.core import Manifest, write_json
from s2gold.formats import bob
from s2gold.formats.bitmaps import DecodedSprite
from s2gold.formats.palette import Palette
from s2gold.upscale import SCALE

BOB_FILES = ("CARRIER.BOB", "CARRIER2.BOB", "JOBS.BOB")

# BOBs the game world draws, which get a 2x set.
HD_BOBS = frozenset({"carrier", "jobs"})

# nx/ny anchor semantics (see s2gold.formats.bob): nx is the fixed 16px x-anchor and ny is
# the BOB per-sprite y-offset. Draw a sprite so its anchor lands on the figure's ground
# reference point, i.e. blit its top-left at ``(dstX - nx, dstY - ny)``.
_ANCHOR_DOC = (
    "nx,ny hotspot; blit top-left at (dstX - nx, dstY - ny). nx is fixed 16; ny is the BOB per-sprite y-offset."
)
_MASK_ENCODING = "R = player-color shade (1-4 as shade+1), A = 255 where player-colored"


def run(extracted: Path, assets: Path, *, hd: bool = True) -> None:
    """Convert every BOB container to atlases and register them in the manifest.

    Args:
        extracted: innoextract output root (contains ``DATA`` and ``GFX``).
        assets: Web asset output root.
        hd: Also write the 2x sets for :data:`HD_BOBS`.
    """
    palette = Palette.from_bbm(extracted / "GFX" / "PALETTE" / STANDARD_PALETTE)
    index: dict[str, object] = {}
    hd_index: dict[str, object] = {}
    for filename in BOB_FILES:
        path = extracted / "DATA" / "BOBS" / filename
        if not path.exists():
            print(f"[bobs] {filename}: not present, skipping")
            continue
        name = path.stem.lower()
        with_hd = hd and name in HD_BOBS
        info = _convert_bob(path, palette, assets / "bobs" / name, hd=with_hd)
        index[name] = f"bobs/{name}/atlas.json"
        if with_hd:
            hd_index[name] = f"bobs/{name}/{HD_DIR}/atlas.json"
        print(
            f"[bobs] {name}: {info['body_count']} bodies, {info['overlay_count']} overlays, "
            f"{info['job_count']} jobs, {info['atlas_count']} atlas(es)"
        )
    manifest = Manifest()
    manifest.add("bobs", index)
    if hd:
        manifest.add("bobs_hd", {"scale": SCALE, "archives": hd_index})
    manifest.save(assets)


def _convert_bob(path: Path, palette: Palette, out_dir: Path, *, hd: bool = False) -> dict[str, object]:
    """Decode, pack and serialise a single BOB file; return a small summary dict."""
    decoded_bob = bob.read_bob(path.read_bytes(), palette)
    overlay_base = len(decoded_bob.bodies)

    decoded: list[tuple[int, DecodedSprite]] = list(enumerate(decoded_bob.bodies))
    decoded += [(overlay_base + j, sprite) for j, sprite in enumerate(decoded_bob.overlays)]

    by_key, atlas_count, has_masks = pack_sprites(decoded, out_dir)
    sprites = _sprite_entries(decoded, by_key, overlay_base, has_masks)

    payload: dict[str, object] = {
        "name": out_dir.name,
        "atlas_count": atlas_count,
        "atlases": [f"atlas_{i}.png" for i in range(atlas_count)],
        "pmasks": [f"pmask_{i}.png" for i in range(atlas_count)] if has_masks else [],
        "mask_encoding": _MASK_ENCODING,
        "anchor": _ANCHOR_DOC,
        "num_bodies": len(decoded_bob.bodies),
        "num_overlays": len(decoded_bob.overlays),
        "num_jobs": decoded_bob.num_jobs,
        "body_base": 0,
        "overlay_base": overlay_base,
        "dims": {
            "fat_types": bob.NUM_FAT_TYPES,
            "directions": bob.NUM_DIRECTIONS,
            "anim_steps": bob.NUM_ANIM_STEPS,
        },
        "body_table": _body_table(),
        "links": _links_table(decoded_bob),
        "sprites": sprites,
    }
    write_json(out_dir / "atlas.json", payload)
    if hd:
        write_hd_set(
            payload, decoded, out_dir, lambda big, placed, masks: _sprite_entries(big, placed, overlay_base, masks)
        )
    return {
        "body_count": len(decoded_bob.bodies),
        "overlay_count": len(decoded_bob.overlays),
        "job_count": decoded_bob.num_jobs,
        "atlas_count": atlas_count,
    }


def _body_table() -> list[list[list[int]]]:
    """Build the ``[fat][direction][step] -> body index`` composition table."""
    return [
        [
            [bob.body_index(bool(fat), direction, step) for step in range(bob.NUM_ANIM_STEPS)]
            for direction in range(bob.NUM_DIRECTIONS)
        ]
        for fat in range(bob.NUM_FAT_TYPES)
    ]


def _links_table(decoded_bob: bob.Bob) -> list[list[list[list[int]]]]:
    """Build the ``[job][step][fat][direction] -> overlay index`` composition table."""
    return [
        [
            [
                [
                    decoded_bob.links[bob.link_index(job, step, bool(fat), direction)]
                    for direction in range(bob.NUM_DIRECTIONS)
                ]
                for fat in range(bob.NUM_FAT_TYPES)
            ]
            for step in range(bob.NUM_ANIM_STEPS)
        ]
        for job in range(decoded_bob.num_jobs)
    ]


def _sprite_entries(
    decoded: list[tuple[int, DecodedSprite]],
    by_key: dict[int, Placement],
    overlay_base: int,
    has_masks: bool,
) -> dict[str, object]:
    """Build the ``sprites`` map for atlas.json, keyed by the shared integer sprite key."""
    sprites: dict[str, object] = {}
    for key, sprite in decoded:
        placement = by_key[key]
        entry: dict[str, object] = {
            "atlas": placement.atlas,
            "x": placement.x,
            "y": placement.y,
            "w": placement.width,
            "h": placement.height,
            "nx": sprite.nx,
            "ny": sprite.ny,
            "kind": "overlay" if key >= overlay_base else "body",
        }
        if has_masks and sprite.player_mask is not None:
            entry["pmask"] = True
            entry["player_indices"] = list(sprite.player_indices)
        sprites[str(key)] = entry
    return sprites

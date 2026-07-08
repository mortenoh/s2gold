"""Simple shelf/row atlas packer for RGBA sprites, backed by Pillow.

Sprites are packed left-to-right into shelves (rows) that wrap at a maximum width; a new
atlas image is started when the next shelf would exceed the maximum height. Each output
image is trimmed to the pixels actually used. This is deliberately simple (not optimal)
but deterministic and fast enough for the game's few thousand sprites.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

MAX_ATLAS_SIZE = 2048
_PADDING = 1


@dataclass(frozen=True)
class SpriteInput:
    """One sprite to pack.

    Attributes:
        key: Caller-defined identifier stored on the placement.
        width: Sprite width in pixels.
        height: Sprite height in pixels.
        rgba: ``width * height * 4`` RGBA bytes (empty for a zero-area sprite).
    """

    key: int
    width: int
    height: int
    rgba: bytes


@dataclass(frozen=True)
class Placement:
    """Where a packed sprite landed."""

    key: int
    atlas: int
    x: int
    y: int
    width: int
    height: int


@dataclass
class _Shelf:
    """A single packing shelf within the current atlas."""

    x: int = 0
    y: int = 0
    height: int = 0


@dataclass
class AtlasPacker:
    """Accumulates sprites into one or more atlas images.

    Attributes:
        max_size: Maximum atlas width and height in pixels.
    """

    max_size: int = MAX_ATLAS_SIZE
    _images: list[Image.Image] = field(default_factory=list)
    _placements: list[Placement] = field(default_factory=list)
    _shelf: _Shelf = field(default_factory=_Shelf)
    _used_w: int = 0
    _used_h: int = 0

    def add(self, sprite: SpriteInput) -> None:
        """Pack one sprite, starting a new atlas if it does not fit the current one."""
        if not self._images:
            self._new_atlas()
        w = min(sprite.width, self.max_size)
        h = min(sprite.height, self.max_size)
        if w == 0 or h == 0 or not sprite.rgba:
            self._placements.append(Placement(sprite.key, len(self._images) - 1, 0, 0, w, h))
            return
        step = _PADDING
        if self._shelf.x + w > self.max_size:
            self._shelf.x = 0
            self._shelf.y += self._shelf.height + step
            self._shelf.height = 0
        if self._shelf.y + h > self.max_size:
            self._new_atlas()
        self._blit(sprite, w, h)

    def _blit(self, sprite: SpriteInput, w: int, h: int) -> None:
        """Draw a sprite at the current shelf cursor and record its placement."""
        img = self._images[-1]
        x, y = self._shelf.x, self._shelf.y
        tile = Image.frombytes("RGBA", (sprite.width, sprite.height), sprite.rgba)
        if (w, h) != (sprite.width, sprite.height):
            tile = tile.crop((0, 0, w, h))
        img.paste(tile, (x, y))
        self._placements.append(Placement(sprite.key, len(self._images) - 1, x, y, w, h))
        self._shelf.x += w + _PADDING
        self._shelf.height = max(self._shelf.height, h)
        self._used_w = max(self._used_w, x + w)
        self._used_h = max(self._used_h, y + h)

    def _new_atlas(self) -> None:
        """Start a fresh atlas image and reset the shelf cursor."""
        self._images.append(Image.new("RGBA", (self.max_size, self.max_size), (0, 0, 0, 0)))
        self._shelf = _Shelf()
        self._used_w = 0
        self._used_h = 0

    def save(self, out_dir: Path, prefix: str = "atlas") -> list[Placement]:
        """Write every atlas image (trimmed to used pixels) and return all placements.

        Args:
            out_dir: Directory to write ``<prefix>_N.png`` files into (created if absent).
            prefix: File name prefix for atlas images.

        Returns:
            The placement of every added sprite, in add order.
        """
        out_dir.mkdir(parents=True, exist_ok=True)
        used = self._atlas_extents()
        for i, img in enumerate(self._images):
            w, h = used.get(i, (1, 1))
            img.crop((0, 0, max(1, w), max(1, h))).save(out_dir / f"{prefix}_{i}.png")
        return list(self._placements)

    def _atlas_extents(self) -> dict[int, tuple[int, int]]:
        """Compute the used width/height of each atlas from its placements."""
        extents: dict[int, tuple[int, int]] = {}
        for p in self._placements:
            w, h = extents.get(p.atlas, (0, 0))
            extents[p.atlas] = (max(w, p.x + p.width), max(h, p.y + p.height))
        return extents

    @property
    def atlas_count(self) -> int:
        """Number of atlas images produced so far."""
        return len(self._images)

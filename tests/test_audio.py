"""Tests for the SFX + music audio converter."""

from __future__ import annotations

import json
import struct
from pathlib import Path

import pytest

from s2gold.convert.audio import _convert_sfx, _iter_lst_sounds, _wav_header
from s2gold.core import Manifest

REPO_ROOT = Path(__file__).resolve().parents[1]
EXTRACTED = REPO_ROOT / "extracted"
SOUND_LST = EXTRACTED / "DATA" / "SOUNDDAT" / "SOUND.LST"

needs_assets = pytest.mark.skipif(not SOUND_LST.is_file(), reason="extracted game data not present")


def test_wav_header_is_44_bytes_and_well_formed() -> None:
    header = _wav_header(1000, 11025, 1, 8)
    assert len(header) == 44
    assert header[:4] == b"RIFF"
    assert header[8:12] == b"WAVE"
    assert header[36:40] == b"data"
    (riff_size,) = struct.unpack("<I", header[4:8])
    assert riff_size == 36 + 1000
    audio_format, channels, sample_rate, byte_rate, block_align, bits = struct.unpack("<HHIIHH", header[20:36])
    assert audio_format == 1
    assert channels == 1
    assert sample_rate == 11025
    assert bits == 8
    assert block_align == 1
    assert byte_rate == 11025


# Verified against this machine's real SOUND.LST: 55 "used" items consume the container
# exactly (final offset == file size) — 54 raw PCM sounds plus the single XMIDI item.
# (The CONTRACTS.md "199" figure does not match the actual extracted file.)
EXPECTED_PCM_SOUNDS = 54


@needs_assets
def test_sound_lst_pcm_item_count() -> None:
    data = SOUND_LST.read_bytes()
    items = list(_iter_lst_sounds(data))
    pcm = [(i, p) for i, p in items if p[:4] not in (b"FORM", b"RIFF")]
    xmidi = [(i, p) for i, p in items if p[:4] == b"FORM"]
    assert len(pcm) == EXPECTED_PCM_SOUNDS
    assert len(xmidi) == 1  # the single XMIDI item that SFX conversion skips


@needs_assets
def test_convert_sfx_produces_valid_wavs(tmp_path: Path) -> None:
    _convert_sfx(EXTRACTED, tmp_path)

    index_path = tmp_path / "sfx" / "index.json"
    assert index_path.is_file()
    index = json.loads(index_path.read_text())
    assert len(index) == EXPECTED_PCM_SOUNDS

    for entry in index.values():
        wav = tmp_path / entry["file"]
        assert wav.is_file()
        head = wav.read_bytes()[:44]
        assert head[:4] == b"RIFF"
        assert head[8:12] == b"WAVE"
        # duration must be positive and sane (SFX are short).
        assert 0.0 < entry["duration"] < 30.0

    # A representative WAV: header data length must match file size.
    sample = tmp_path / next(iter(index.values()))["file"]
    raw = sample.read_bytes()
    (data_len,) = struct.unpack("<I", raw[40:44])
    assert data_len == len(raw) - 44


@needs_assets
def test_convert_sfx_returns_manifest_payload(tmp_path: Path) -> None:
    payload = _convert_sfx(EXTRACTED, tmp_path)
    assert payload["dir"] == "sfx"
    assert payload["count"] == EXPECTED_PCM_SOUNDS


def test_manifest_merge_preserves_other_categories(tmp_path: Path) -> None:
    first = Manifest()
    first.add("terrain", {"foo": "bar"})
    first.save(tmp_path)
    second = Manifest()
    second.add("sfx", {"count": 1})
    second.save(tmp_path)
    merged = json.loads((tmp_path / "manifest.json").read_text())
    assert "terrain" in merged["categories"]
    assert "sfx" in merged["categories"]

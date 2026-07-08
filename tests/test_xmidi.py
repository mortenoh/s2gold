"""Tests for the XMIDI -> Standard MIDI File converter."""

from __future__ import annotations

import shutil
import struct
import subprocess
from pathlib import Path

import pytest

from s2gold.formats.xmidi import (
    SMF_PPQN,
    _build_track,
    _parse_events,
    _read_varlen,
    _write_varlen,
    count_sequences,
    xmidi_to_smf,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
SNG_DIR = REPO_ROOT / "extracted" / "DATA" / "SOUNDDAT" / "SNG"
SNG_0001 = SNG_DIR / "SNG_0001.DAT"

needs_assets = pytest.mark.skipif(not SNG_0001.is_file(), reason="extracted game data not present")


@pytest.mark.parametrize("value", [0, 1, 0x7F, 0x80, 0x3FFF, 0x4000, 0x1FFFFF])
def test_varlen_roundtrip(value: int) -> None:
    encoded = _write_varlen(value)
    decoded, pos = _read_varlen(encoded, 0)
    assert decoded == value
    assert pos == len(encoded)


def test_write_varlen_known_values() -> None:
    assert _write_varlen(0) == b"\x00"
    assert _write_varlen(0x7F) == b"\x7f"
    assert _write_varlen(0x80) == b"\x81\x00"
    assert _write_varlen(0x3FFF) == b"\xff\x7f"


def test_parse_events_note_off_synthesis() -> None:
    # note-on ch0 note 0x40 vel 0x64 duration 0x10, then delay 0x20, then program change.
    evnt = bytes([0x90, 0x40, 0x64, 0x10, 0x20, 0xC0, 0x05])
    events = _parse_events(evnt, 0, len(evnt))
    note_ons = [e for e in events if e[2][0] & 0xF0 == 0x90 and e[2][2] != 0]
    note_offs = [e for e in events if e[2][0] & 0xF0 == 0x90 and e[2][2] == 0]
    assert len(note_ons) == 1
    assert len(note_offs) == 1
    assert note_ons[0][0] == 0  # note-on at tick 0
    assert note_offs[0][0] == 0x10  # note-off after duration
    prog = [e for e in events if e[2][0] & 0xF0 == 0xC0]
    assert prog and prog[0][0] == 0x20  # program change after the delay run


def test_parse_events_drops_tempo() -> None:
    # tempo meta (0xFF 0x51) must be dropped as vestigial.
    evnt = bytes([0xFF, 0x51, 0x03, 0x09, 0x27, 0xC0, 0xC0, 0x01])
    events = _parse_events(evnt, 0, len(evnt))
    assert all(not (e[2][0] == 0xFF and e[2][1] == 0x51) for e in events)


def test_build_track_is_valid_mtrk() -> None:
    events = _parse_events(bytes([0x90, 0x40, 0x64, 0x08]), 0, 4)
    track = _build_track(events)
    assert track[:4] == b"MTrk"
    declared = struct.unpack(">I", track[4:8])[0]
    assert declared == len(track) - 8
    assert track.endswith(bytes([0xFF, 0x2F, 0x00]))


@needs_assets
def test_count_sequences() -> None:
    assert count_sequences(SNG_0001.read_bytes()) == 1


@needs_assets
def test_smf_header() -> None:
    smf = xmidi_to_smf(SNG_0001.read_bytes())
    assert smf[:4] == b"MThd"
    length, fmt, ntrks, division = struct.unpack(">IHHH", smf[4:14])
    assert length == 6
    assert fmt == 0
    assert ntrks == 1
    assert division == SMF_PPQN


@needs_assets
def test_balanced_note_events_per_channel() -> None:
    """Every note-on must have a matching note-off on the same channel."""
    smf = xmidi_to_smf(SNG_0001.read_bytes())
    track_start = smf.index(b"MTrk") + 8
    on_counts: dict[int, int] = {}
    off_counts: dict[int, int] = {}
    pos = track_start
    running_status = 0
    while pos < len(smf):
        _delta, pos = _read_varlen(smf, pos)
        status = smf[pos]
        if status & 0x80:
            pos += 1
        else:
            status = running_status
        high = status & 0xF0
        channel = status & 0x0F
        if status == 0xFF:
            mtype = smf[pos]
            length, pos = _read_varlen(smf, pos + 1)
            pos += length
            if mtype == 0x2F:
                break
            continue
        if status in (0xF0, 0xF7):
            length, pos = _read_varlen(smf, pos)
            pos += length
            continue
        running_status = status
        if high == 0x90:
            velocity = smf[pos + 1]
            pos += 2
            if velocity == 0:
                off_counts[channel] = off_counts.get(channel, 0) + 1
            else:
                on_counts[channel] = on_counts.get(channel, 0) + 1
        elif high == 0x80:
            pos += 2
            off_counts[channel] = off_counts.get(channel, 0) + 1
        elif high in (0xA0, 0xB0, 0xE0):
            pos += 2
        elif high in (0xC0, 0xD0):
            pos += 1
        else:
            pytest.fail(f"unexpected status {status:#04x} at {pos}")

    assert on_counts, "expected at least one note-on"
    assert on_counts == off_counts


@needs_assets
@pytest.mark.skipif(shutil.which("fluidsynth") is None, reason="fluidsynth not installed")
@pytest.mark.slow
def test_fluidsynth_renders(tmp_path: Path) -> None:
    """The converted SMF must render without error under fluidsynth (needs a soundfont)."""
    from s2gold.convert.audio import _resolve_soundfont

    soundfont = _resolve_soundfont()
    if soundfont is None:
        pytest.skip("no soundfont available")
    smf = xmidi_to_smf(SNG_0001.read_bytes())
    mid = tmp_path / "t.mid"
    mid.write_bytes(smf)
    wav = tmp_path / "t.wav"
    proc = subprocess.run(
        ["fluidsynth", "-ni", "-F", str(wav), "-r", "44100", str(soundfont), str(mid)],
        capture_output=True,
        check=True,
    )
    assert proc.returncode == 0
    assert wav.is_file()
    assert wav.stat().st_size > 44

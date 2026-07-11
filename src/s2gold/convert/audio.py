"""Audio converter: sound effects (SOUND.LST) and music (XMIDI -> SMF -> OGG).

Sound effects come from ``DATA/SOUNDDAT/SOUND.LST`` (an LST container of raw unsigned
8-bit PCM payloads, plus one XMIDI item that is skipped here). Each PCM item is wrapped
in a 44-byte WAV header at 11025 Hz mono and written to ``sfx/<id>.wav``.

Music comes from ``DATA/SOUNDDAT/SNG/SNG_*.DAT`` (bare XMIDI). Each is converted to a
Standard MIDI File, rendered to WAV with fluidsynth and a General MIDI soundfont, then
encoded to OGG Vorbis with ffmpeg. Music is skipped with a clear notice (never a hard
failure) when a soundfont, fluidsynth, or ffmpeg is unavailable.
"""

from __future__ import annotations

import http.client
import struct
import urllib.request
from pathlib import Path

from s2gold.core import ASSETS_DIR, Manifest, find_tool, run_tool, write_json
from s2gold.formats.binio import Reader
from s2gold.formats.xmidi import xmidi_to_smf

SFX_SAMPLE_RATE = 11025
LST_MAGIC = 0x4E20
BOBTYPE_SOUND = 1

# Cache directory (gitignored) for downloaded soundfonts and intermediate MIDI files.
ASSETS_CACHE = Path(__file__).resolve().parents[3] / "assets-cache"
GENERALUSER_GS_URL = "https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2"
GENERALUSER_GS_NAME = "GeneralUser-GS.sf2"
HOMEBREW_SOUNDFONTS = Path("/opt/homebrew/share/soundfonts")


def _wav_header(data_len: int, sample_rate: int, channels: int, bits: int) -> bytes:
    """Build a 44-byte canonical PCM WAV header.

    Args:
        data_len: Length of the raw PCM payload in bytes.
        sample_rate: Samples per second.
        channels: Channel count.
        bits: Bits per sample.

    Returns:
        The 44-byte RIFF/WAVE header.
    """
    block_align = channels * bits // 8
    byte_rate = sample_rate * block_align
    return struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_len,
        b"WAVE",
        b"fmt ",
        16,
        1,  # PCM
        channels,
        sample_rate,
        byte_rate,
        block_align,
        bits,
        b"data",
        data_len,
    )


def _iter_lst_sounds(data: bytes):  # type: ignore[no-untyped-def]
    """Yield ``(index, payload)`` for every used sound item in a SOUND.LST buffer.

    Args:
        data: The raw SOUND.LST bytes.

    Yields:
        ``(index, payload)`` tuples in container order, where ``payload`` is the raw
        item body (PCM, RIFF, or XMIDI).

    Raises:
        ValueError: If the container magic is not 0x4E20.
    """
    r = Reader(data)
    magic = r.u16()
    if magic != LST_MAGIC:
        raise ValueError(f"SOUND.LST bad magic {magic:#06x}, expected {LST_MAGIC:#06x}")
    count = r.u32()
    for index in range(count):
        used = r.s16()
        if used != 1:
            # Unused slots are just the 2-byte "used" flag with no bobtype/payload;
            # skip to the next slot. (This exactly consumes the real SOUND.LST.)
            continue
        bobtype = r.s16()
        if bobtype != BOBTYPE_SOUND:
            raise ValueError(f"item {index}: unexpected bobtype {bobtype}, expected {BOBTYPE_SOUND}")
        length = r.u32()
        payload = r.bytes(length)
        yield index, payload


def _convert_sfx(extracted: Path, assets: Path) -> dict[str, object]:
    """Convert SOUND.LST sound effects to WAV files and build the sfx index.

    Args:
        extracted: innoextract output root.
        assets: web asset output root.

    Returns:
        The sfx manifest payload (``{"dir": "sfx", "items": {...}}``).
    """
    lst_path = extracted / "DATA" / "SOUNDDAT" / "SOUND.LST"
    out_dir = assets / "sfx"
    out_dir.mkdir(parents=True, exist_ok=True)

    items: dict[str, object] = {}
    data = lst_path.read_bytes()
    for index, payload in _iter_lst_sounds(data):
        if payload[:4] == b"FORM":
            # The single XMIDI item in SOUND.LST is not a sound effect.
            continue
        name = f"{index}.wav"
        out_path = out_dir / name
        if payload[:4] == b"RIFF":
            out_path.write_bytes(payload)
            duration = _wav_duration(payload)
        else:
            # Raw unsigned 8-bit PCM, mono, 11025 Hz (verified in CONTRACTS.md).
            out_path.write_bytes(_wav_header(len(payload), SFX_SAMPLE_RATE, 1, 8) + payload)
            duration = len(payload) / SFX_SAMPLE_RATE
        items[str(index)] = {"file": f"sfx/{name}", "duration": round(duration, 4)}

    write_json(out_dir / "index.json", items)
    print(f"[audio] sfx: {len(items)} PCM sounds -> {out_dir}")
    return {"dir": "sfx", "count": len(items), "items": items}


def _wav_duration(riff: bytes) -> float:
    """Estimate the duration in seconds of an existing RIFF/WAVE buffer.

    Args:
        riff: The full WAV file bytes.

    Returns:
        Duration in seconds, or 0.0 if the header cannot be read.
    """
    try:
        _channels, sample_rate, _byte_rate, block_align, _bits = struct.unpack("<HIIHH", riff[22:36])
        pos = 12
        while pos + 8 <= len(riff):
            chunk_id = riff[pos : pos + 4]
            chunk_len = int(struct.unpack("<I", riff[pos + 4 : pos + 8])[0])
            if chunk_id == b"data":
                frames = chunk_len / max(1, int(block_align))
                return frames / max(1, int(sample_rate))
            pos += 8 + chunk_len + (chunk_len & 1)
    except (struct.error, IndexError, ZeroDivisionError):
        return 0.0
    return 0.0


def _mp3_encoder_args(ffmpeg: str) -> list[str] | None:
    """Choose ffmpeg args for MP3 encoding.

    MP3 is used for music because it decodes natively in every browser (Safari
    included, unlike OGG Vorbis) and its patents have expired. Requires libmp3lame
    (VBR -q:a 4); without it music conversion is skipped.

    Args:
        ffmpeg: Path to the ffmpeg binary.

    Returns:
        The ``-c:a ...`` argument list, or None if no MP3 encoder is available.
    """
    try:
        encoders = run_tool([ffmpeg, "-hide_banner", "-encoders"]).stdout.decode("utf-8", "replace")
    except OSError:
        return None
    if "libmp3lame" in encoders:
        return ["-c:a", "libmp3lame", "-q:a", "4"]
    return None


def _resolve_soundfont() -> Path | None:
    """Resolve a General MIDI soundfont, downloading GeneralUser GS as a last resort.

    Resolution order: ``$S2GOLD_SOUNDFONT``, any ``.sf2`` under ``assets-cache/``,
    ``/opt/homebrew/share/soundfonts/*.sf2``, then download GeneralUser GS.

    Returns:
        A path to a usable ``.sf2`` file, or None if none could be obtained.
    """
    import os

    env = os.environ.get("S2GOLD_SOUNDFONT")
    if env:
        p = Path(env)
        if p.is_file():
            return p
        print(f"[audio] $S2GOLD_SOUNDFONT points at missing file {p}, ignoring")

    for candidate_dir in (ASSETS_CACHE, HOMEBREW_SOUNDFONTS):
        if candidate_dir.is_dir():
            for found in sorted(candidate_dir.glob("*.sf2")):
                # Sanity-check the header: a truncated file left by an
                # interrupted download must not be reused as a cache hit.
                if _looks_like_sf2(found):
                    return found
                print(f"[audio] ignoring invalid soundfont {found}")

    # Last resort: download GeneralUser GS (LGPL) into the gitignored cache.
    ASSETS_CACHE.mkdir(parents=True, exist_ok=True)
    dest = ASSETS_CACHE / GENERALUSER_GS_NAME
    tmp = dest.with_suffix(".sf2.partial")
    try:
        print(f"[audio] downloading soundfont {GENERALUSER_GS_URL}")
        with urllib.request.urlopen(GENERALUSER_GS_URL) as resp:  # noqa: S310 - fixed trusted URL
            tmp.write_bytes(resp.read())
        tmp.replace(dest)
    except (OSError, http.client.HTTPException) as exc:
        # IncompleteRead is an HTTPException, not an OSError; either way the
        # partial file is discarded so it can never poison the cache.
        tmp.unlink(missing_ok=True)
        print(f"[audio] soundfont download failed: {exc}")
        return None
    if _looks_like_sf2(dest):
        return dest
    return None


def _looks_like_sf2(path: Path) -> bool:
    """True when the file carries the RIFF/sfbk header of a real SoundFont."""
    try:
        with path.open("rb") as fh:
            header = fh.read(12)
    except OSError:
        return False
    return len(header) == 12 and header[:4] == b"RIFF" and header[8:12] == b"sfbk"


def _convert_music(extracted: Path, assets: Path) -> dict[str, object] | None:
    """Convert SNG XMIDI tracks to OGG via SMF, fluidsynth, and ffmpeg.

    Args:
        extracted: innoextract output root.
        assets: web asset output root.

    Returns:
        The music manifest payload, or None when music conversion was skipped.
    """
    sng_dir = extracted / "DATA" / "SOUNDDAT" / "SNG"
    sng_files = sorted(sng_dir.glob("SNG_*.DAT"))
    if not sng_files:
        print("[audio] music: no SNG_*.DAT files found, skipping")
        return None

    fluidsynth = find_tool("fluidsynth")
    ffmpeg = find_tool("ffmpeg")
    if fluidsynth is None or ffmpeg is None:
        print("[audio] music: fluidsynth and/or ffmpeg missing, skipping music conversion")
        return None

    mp3_args = _mp3_encoder_args(ffmpeg)
    if mp3_args is None:
        print("[audio] music: ffmpeg has no MP3 encoder (libmp3lame), skipping music conversion")
        return None

    soundfont = _resolve_soundfont()
    if soundfont is None:
        print("[audio] music: no soundfont available, skipping music conversion")
        return None
    print(f"[audio] music: using soundfont {soundfont}")

    out_dir = assets / "music"
    out_dir.mkdir(parents=True, exist_ok=True)
    mid_dir = ASSETS_CACHE / "mid"
    mid_dir.mkdir(parents=True, exist_ok=True)
    wav_dir = ASSETS_CACHE / "wav"
    wav_dir.mkdir(parents=True, exist_ok=True)

    items: dict[str, object] = {}
    for sng in sng_files:
        name = sng.stem.lower()  # e.g. "sng_0001"
        try:
            smf = xmidi_to_smf(sng.read_bytes())
        except ValueError as exc:
            print(f"[audio] music: {sng.name} XMIDI parse failed ({exc}), skipping track")
            continue
        mid_path = mid_dir / f"{name}.mid"
        mid_path.write_bytes(smf)

        wav_path = wav_dir / f"{name}.wav"
        run_tool([fluidsynth, "-ni", "-F", str(wav_path), "-r", "44100", str(soundfont), str(mid_path)])

        mp3_path = out_dir / f"{name}.mp3"
        run_tool([ffmpeg, "-y", "-v", "error", "-i", str(wav_path), *mp3_args, str(mp3_path)])

        duration = _wav_duration(wav_path.read_bytes())
        items[name] = {"file": f"music/{name}.mp3", "duration": round(duration, 3)}
        print(f"[audio] music: {name} -> {mp3_path.name} ({duration:.1f}s)")

    if not items:
        return None
    write_json(out_dir / "index.json", items)
    return {"dir": "music", "count": len(items), "soundfont": soundfont.name, "items": items}


def run(extracted: Path, assets: Path = ASSETS_DIR) -> None:
    """Convert sound effects and music, registering both in the manifest.

    Args:
        extracted: innoextract output root (contains ``DATA/``).
        assets: web asset output root.
    """
    manifest = Manifest()
    sfx_payload = _convert_sfx(extracted, assets)
    manifest.add("sfx", sfx_payload)

    music_payload = _convert_music(extracted, assets)
    if music_payload is not None:
        manifest.add("music", music_payload)

    manifest.save(assets)

"""Video converter: the Smacker intro (VIDEO/INTRO.SMK) to MP4.

ffmpeg decodes the Smacker container (smackvideo + smackaudio) directly, so conversion is
a single transcode to H.264 video + AAC audio. MP4/H.264 is used because it plays
natively in every browser (Safari included, unlike WebM/VP9); ``yuv420p`` and
``+faststart`` are required for Safari playback and progressive web streaming. The step
is skipped with a notice (never a hard failure) when ffmpeg is unavailable or no intro
file is present.
"""

from __future__ import annotations

from pathlib import Path

from s2gold.core import ASSETS_DIR, Manifest, find_tool, run_tool, write_json


def _probe_has_audio(ffprobe: str, src: Path) -> bool:
    """Return True if ``src`` contains at least one audio stream."""
    result = run_tool(
        [ffprobe, "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", str(src)]
    )
    return bool(result.stdout.strip())


def run(extracted: Path, assets: Path = ASSETS_DIR) -> None:
    """Convert VIDEO/INTRO.SMK to video/intro.mp4 and register it in the manifest.

    Args:
        extracted: innoextract output root (contains ``VIDEO/``).
        assets: web asset output root.
    """
    src = extracted / "VIDEO" / "INTRO.SMK"
    if not src.is_file():
        print("[video] no VIDEO/INTRO.SMK found, skipping")
        return

    ffmpeg = find_tool("ffmpeg")
    if ffmpeg is None:
        print("[video] ffmpeg missing, skipping video conversion")
        return

    out_dir = assets / "video"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "intro.mp4"

    ffprobe = find_tool("ffprobe")
    has_audio = _probe_has_audio(ffprobe, src) if ffprobe else True

    args = [
        ffmpeg,
        "-y",
        "-v",
        "error",
        "-i",
        str(src),
        "-c:v",
        "libx264",
        "-crf",
        "20",
        "-preset",
        "slow",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
    ]
    if has_audio:
        args += ["-c:a", "aac", "-b:a", "128k"]
    else:
        args += ["-an"]
    args.append(str(out_path))
    print(f"[video] transcoding {src.name} -> {out_path.name} (audio={has_audio})")
    run_tool(args)

    manifest = Manifest()
    manifest.add("video", {"dir": "video", "intro": "video/intro.mp4"})
    manifest.save(assets)
    write_json(out_dir / "index.json", {"intro": "video/intro.mp4"})

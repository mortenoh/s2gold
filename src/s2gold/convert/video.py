"""Video converter: the Smacker intro (VIDEO/INTRO.SMK) to WebM.

ffmpeg decodes the Smacker container (smackvideo + smackaudio) directly, so conversion is
a single transcode to VP9 video + Opus audio. The step is skipped with a notice (never a
hard failure) when ffmpeg is unavailable or no intro file is present.
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
    """Convert VIDEO/INTRO.SMK to video/intro.webm and register it in the manifest.

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
    out_path = out_dir / "intro.webm"

    ffprobe = find_tool("ffprobe")
    has_audio = _probe_has_audio(ffprobe, src) if ffprobe else True

    args = [ffmpeg, "-y", "-v", "error", "-i", str(src), "-c:v", "libvpx-vp9", "-crf", "33", "-b:v", "0"]
    if has_audio:
        args += ["-c:a", "libopus"]
    else:
        args += ["-an"]
    args.append(str(out_path))
    print(f"[video] transcoding {src.name} -> {out_path.name} (audio={has_audio})")
    run_tool(args)

    manifest = Manifest()
    manifest.add("video", {"dir": "video", "intro": "video/intro.webm"})
    manifest.save(assets)
    write_json(out_dir / "index.json", {"intro": "video/intro.webm"})

"""Conversion limits from the environment (compose: DOCLING_*). Audio and video get longer: CPU transcription is slow."""
import os

MEDIA_EXTENSIONS = frozenset({".aac", ".flac", ".m4a", ".mp3", ".ogg", ".wav", ".avi", ".mkv", ".mov", ".mp4", ".webm"})


def _seconds(name: str, default: int) -> int:
    try:
        return max(30, int(os.environ.get(name, default)))
    except ValueError:
        return default


def concurrency() -> int:
    try:
        return max(1, int(os.environ.get("DOCLING_CONCURRENCY", 2)))
    except ValueError:
        return 2


def job_timeout(suffix: str) -> int:
    """Wall-clock limit for one conversion process, including LibreOffice/FFmpeg children."""
    if suffix.lower() in MEDIA_EXTENSIONS:
        return _seconds("DOCLING_MEDIA_TIMEOUT_S", 900)
    return _seconds("DOCLING_DOCUMENT_TIMEOUT_S", 300)

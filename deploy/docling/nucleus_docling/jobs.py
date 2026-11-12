"""Bounded subprocess jobs: timeout kills the process group, including LibreOffice and FFmpeg."""
import json
import os
import signal
import subprocess
import sys
from pathlib import Path

from nucleus_docling.limits import job_timeout

MAX_RESULT = 20 * 1024 * 1024


def run_job(directory: Path):
    timeout = job_timeout(next(directory.glob("input.*")).suffix)
    process = subprocess.Popen([sys.executable, "-m", "nucleus_docling.convert", str(directory)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
        return {"ok": False, "code": "FILE_PARSE_TIMEOUT",
                "detail": f"CPU conversion exceeded {timeout // 60} minutes; split the document or shorten the recording, or reprocess when the converter is less busy."}
    output = directory / "result.json"
    if not output.exists() or output.stat().st_size > MAX_RESULT:
        return {"ok": False, "code": "FILE_PARSE_ERROR", "detail": "Document conversion failed or exceeded the output limit."}
    return json.loads(output.read_text())

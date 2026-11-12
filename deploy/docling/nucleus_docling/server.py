"""Internal upload-only service; each conversion runs in a fresh bounded process."""
import asyncio
import json
import tempfile
from importlib.metadata import version
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile

from nucleus_docling.jobs import run_job
from nucleus_docling.limits import concurrency

MAX_UPLOAD = 50 * 1024 * 1024
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
slots = asyncio.Semaphore(concurrency())


@app.get("/health")
def health():
    return {"ok": True, "device": "cpu", "docling": version("docling-slim")}


@app.middleware("http")
async def body_limit(request: Request, call_next):
    if request.method == "POST":
        raw = request.headers.get("content-length", "")
        if not raw.isdigit() or int(raw) > MAX_UPLOAD + 64 * 1024:
            from fastapi.responses import JSONResponse

            return JSONResponse({"ok": False, "code": "FILE_TOO_LARGE", "detail": "A bounded Content-Length is required."}, status_code=413)
    return await call_next(request)


@app.post("/convert")
async def convert(file: UploadFile = File(...), options: str = Form("{}")):
    from docling.datamodel.base_models import FormatToExtensions

    if len(options) > 16_000:
        raise HTTPException(422, "Conversion options are too large")
    try:
        config = json.loads(options)
    except ValueError:
        raise HTTPException(422, "Invalid conversion options") from None
    if not isinstance(config, dict) or set(config) - {"ocr", "ocr_langs", "ebcdic_layout"}:
        raise HTTPException(422, "Unsupported conversion options")
    if ("ocr" in config and not isinstance(config["ocr"], bool)) or not isinstance(config.get("ocr_langs", "eng+ron"), str):
        raise HTTPException(422, "Invalid OCR options")
    if config.get("ebcdic_layout") is not None and not isinstance(config["ebcdic_layout"], dict):
        raise HTTPException(422, "EBCDIC layout must be an object")
    extensions = {f".{ext.lower()}" for values in FormatToExtensions.values() for ext in values}
    filename = file.filename or ""
    extension = next((ext for ext in sorted(extensions, key=len, reverse=True) if filename.lower().endswith(ext)), None)
    if extension is None:
        raise HTTPException(415, "Unsupported document extension")
    async with slots:
        with tempfile.TemporaryDirectory(prefix="convert-") as raw:
            directory = Path(raw)
            size = 0
            with (directory / f"input{extension}").open("wb") as destination:
                while data := await file.read(1024 * 1024):
                    size += len(data)
                    if size > MAX_UPLOAD:
                        raise HTTPException(413, "Document exceeds conversion size limit")
                    destination.write(data)
            (directory / "options.json").write_text(json.dumps(config))
            return await asyncio.to_thread(run_job, directory)

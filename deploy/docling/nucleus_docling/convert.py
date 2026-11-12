"""CPU-only conversion subprocess. Source content and parser errors never go to service logs."""
import json
import mimetypes
import sys
from pathlib import Path
from typing import get_args

from docling.datamodel.accelerator_options import AcceleratorDevice, AcceleratorOptions
from docling.datamodel.backend_options import BaseBackendOptions, EbcdicBackendOptions
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import TesseractCliOcrOptions
from docling.document_converter import DocumentConverter


# docling-core validates a document's MIME type against Python's registry, which depends on the OS media-types file.
# Register the audio/video types Docling converts so slim images do not reject them (Matroska failed this way).
MEDIA_TYPES = {".mkv": "video/x-matroska", ".webm": "video/webm", ".avi": "video/x-msvideo", ".mov": "video/quicktime",
               ".m4a": "audio/mp4", ".aac": "audio/aac", ".flac": "audio/flac", ".ogg": "audio/ogg", ".wav": "audio/x-wav"}
for _ext, _type in MEDIA_TYPES.items():
    mimetypes.add_type(_type, _ext)


def converter_for(config):
    converter = DocumentConverter()
    for fmt, option in converter.format_to_options.items():
        pipeline = option.pipeline_options
        pipeline.accelerator_options = AcceleratorOptions(device=AcceleratorDevice.CPU, num_threads=2)
        pipeline.enable_remote_services = False
        pipeline.allow_external_plugins = False
        pipeline.artifacts_path = Path("/models")
        pipeline.document_timeout = config.get("document_timeout", 270)   # Docling's own stop, before the process limit
        if hasattr(pipeline, "do_ocr"):
            pipeline.do_ocr = config.get("ocr", True)
            pipeline.ocr_options = TesseractCliOcrOptions(lang=config.get("ocr_langs", "eng+ron").split("+"))
        if option.backend_options is None:
            annotation = type(option).model_fields["backend_options"].annotation
            candidates = [v for v in get_args(annotation) if isinstance(v, type) and issubclass(v, BaseBackendOptions)]
            option.backend_options = candidates[0]() if candidates else None
        if option.backend_options is not None:
            option.backend_options.enable_local_fetch = False
            option.backend_options.enable_remote_fetch = False
        if fmt == InputFormat.EBCDIC:
            option.backend_options = EbcdicBackendOptions.model_validate({"layout": config.get("ebcdic_layout")})
    return converter


def convert(directory):
    from nucleus_docling.extract import extract
    from nucleus_docling.templates import as_document
    from nucleus_docling.validation import validate

    source = next(directory.glob("input.*"))
    config = json.loads((directory / "options.json").read_text())
    validate(source)
    if source.suffix in (".ebc", ".ebcdic") and not config.get("ebcdic_layout"):
        return {"ok": False, "code": "FILE_LAYOUT_REQUIRED", "detail": "EBCDIC needs an explicit record layout. Configure it in collection settings and reprocess the file."}
    from nucleus_docling.limits import job_timeout

    converter = converter_for({**config, "document_timeout": job_timeout(source.suffix) - 30})
    result = converter.convert(as_document(source), max_num_pages=1000, max_file_size=50 * 1024 * 1024)
    return extract(result)


GENERIC_FAILURE = "The document could not be converted safely. Check its format, encryption and structural integrity."
NEEDS_FETCH = ("The document refers to external resources it needs (for example an XBRL instance and its taxonomy). "
               "Conversion runs offline, so upload a self-contained version, such as the inline XBRL (.htm) report.")


def failure(error: Exception) -> dict:
    """A safe, actionable result for a failed conversion; parser messages never leave this process."""
    from docling.exceptions import OperationNotAllowed

    from nucleus_docling.validation import UnsafeDocument

    if isinstance(error, UnsafeDocument):
        return {"ok": False, "code": error.code, "detail": error.detail}
    cause = error
    while cause is not None:
        if isinstance(cause, OperationNotAllowed):
            return {"ok": False, "code": "FILE_EXTERNAL_REFERENCE", "detail": NEEDS_FETCH}
        cause = cause.__cause__ or cause.__context__
    return {"ok": False, "code": "FILE_PARSE_ERROR", "detail": GENERIC_FAILURE}


if __name__ == "__main__":
    directory = Path(sys.argv[1])
    try:
        output = convert(directory)
    except Exception as error:  # noqa: BLE001 - untrusted parser process boundary; never echo parser errors
        output = failure(error)
    (directory / "result.json").write_text(json.dumps(output, allow_nan=False))

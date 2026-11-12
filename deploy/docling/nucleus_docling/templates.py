"""Office templates convert as their document type.

A template (.dotx/.potx/.xltx, .ott/.ots/.otp) is the same package as its document with a different declared content
type, and Docling's backends only open documents. The declaration is rewritten in a copy; nothing inside is executed.
"""
import zipfile
from pathlib import Path

OOXML = {   # template main part -> document main part, document extension
    b"wordprocessingml.template.main+xml": (b"wordprocessingml.document.main+xml", ".docx"),
    b"presentationml.template.main+xml": (b"presentationml.presentation.main+xml", ".pptx"),
    b"spreadsheetml.template.main+xml": (b"spreadsheetml.sheet.main+xml", ".xlsx"),
}
ODF = {   # template mimetype -> document mimetype, document extension
    b"application/vnd.oasis.opendocument.text-template": (b"application/vnd.oasis.opendocument.text", ".odt"),
    b"application/vnd.oasis.opendocument.spreadsheet-template": (b"application/vnd.oasis.opendocument.spreadsheet", ".ods"),
    b"application/vnd.oasis.opendocument.presentation-template": (b"application/vnd.oasis.opendocument.presentation", ".odp"),
}


def _rewrite(source: Path, target: Path, replace: dict[str, tuple[bytes, bytes]]) -> None:
    """Copy the package, replacing bytes in the named entries; ODF's ``mimetype`` stays first and uncompressed."""
    with zipfile.ZipFile(source) as src, zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as out:
        for item in src.infolist():
            data = src.read(item)
            if item.filename in replace:
                old, new = replace[item.filename]
                data = data.replace(old, new)
            out.writestr(item, data, compress_type=zipfile.ZIP_STORED if item.filename == "mimetype" else zipfile.ZIP_DEFLATED)


def as_document(source: Path) -> Path:
    """The path to convert: ``source`` itself, or a rewritten copy when it is an Office template."""
    if not zipfile.is_zipfile(source):
        return source
    with zipfile.ZipFile(source) as archive:
        names = set(archive.namelist())
        content_types = archive.read("[Content_Types].xml") if "[Content_Types].xml" in names else b""
        mimetype = archive.read("mimetype").strip() if "mimetype" in names else b""
    for template, (document, ext) in OOXML.items():
        if template in content_types:
            target = source.with_name(f"document{ext}")
            _rewrite(source, target, {"[Content_Types].xml": (template, document)})
            return target
    if mimetype in ODF:
        document, ext = ODF[mimetype]
        target = source.with_name(f"document{ext}")
        _rewrite(source, target, {"mimetype": (mimetype, document), "META-INF/manifest.xml": (mimetype, document)})
        return target
    return source

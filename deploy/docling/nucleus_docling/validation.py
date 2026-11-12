"""Reject active content, archive escapes/bombs and XML entity declarations before conversion."""
import re
import tarfile
import zipfile
from pathlib import PurePosixPath

MAX_TOTAL = 300 * 1024 * 1024
INTERNAL_SUBSET = re.compile(rb"<!DOCTYPE[^>\[]*\[")


class UnsafeDocument(Exception):
    def __init__(self, code, detail):
        self.code, self.detail = code, detail


def reject(code, detail):
    raise UnsafeDocument(code, detail)


def safe_name(name):
    path = PurePosixPath(name.replace("\\", "/"))
    return not path.is_absolute() and ".." not in path.parts and not (path.parts and ":" in path.parts[0])


def validate(path):
    if path.suffix.lower() in {".docm", ".dotm", ".xlsm", ".xltm", ".pptm", ".potm", ".ppsm"}:
        reject("FILE_MACROS", "Macro-enabled documents are blocked by Nucleus's upload policy.")
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            total = sum(item.file_size for item in entries)
            packed = max(1, sum(item.compress_size for item in entries))
            if len(entries) > 10_000 or total > MAX_TOTAL or total / packed > 100:
                reject("FILE_LIMIT_EXCEEDED", "Archive exceeds expansion limits.")
            for item in entries:
                name = item.filename.lower()
                if not safe_name(name) or (item.external_attr >> 16) & 0o170000 == 0o120000:
                    reject("FILE_UNSAFE_ARCHIVE", "Archive paths or links escape the document.")
                if item.flag_bits & 1:
                    reject("FILE_ENCRYPTED", "Encrypted archives cannot be processed.")
                if name.endswith("vbaproject.bin") or name.startswith(("basic/", "scripts/", "macros/")):
                    reject("FILE_MACROS", "Embedded document macros are blocked.")
    if str(path).endswith(".tar.gz"):
        total, count = 0, 0
        with tarfile.open(path, "r:gz") as archive:
            for item in archive:
                total += item.size
                count += 1
                if count > 10_000 or total > MAX_TOTAL or total / max(1, path.stat().st_size) > 100:
                    reject("FILE_LIMIT_EXCEEDED", "Archive exceeds expansion limits.")
                if not safe_name(item.name) or not (item.isfile() or item.isdir()):
                    reject("FILE_UNSAFE_ARCHIVE", "Archive paths or links escape the document.")
    if path.suffix in {".xml", ".nxml", ".xbrl", ".dclg"}:
        raw = path.read_bytes()
        if raw.startswith((b"\x00\x00\xfe\xff", b"\xff\xfe\x00\x00")):
            content = raw.decode("utf-32", errors="replace").upper().encode()
        elif raw.startswith((b"\xff\xfe", b"\xfe\xff")):
            content = raw.decode("utf-16", errors="replace").upper().encode()
        else:
            content = raw.upper()
        # A DOCTYPE that only names its DTD (JATS, XBRL) is common and harmless here: the converter has no network and
        # does not load DTDs. Entity declarations and internal DTD subsets, the XXE/billion-laughs vectors, stay blocked.
        if b"<!ENTITY" in content or INTERNAL_SUBSET.search(content):
            reject("FILE_EXTERNAL_REFERENCE", "XML entity declarations and inline DTDs are blocked. Export self-contained XML without them.")

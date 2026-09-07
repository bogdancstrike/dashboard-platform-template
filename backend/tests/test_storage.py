"""Where the bytes live (§20, §29, §30).

The interface exists so MinIO, S3 and a local directory are one code path, so
what is asserted here is the *contract* rather than either implementation: a
generated key that a client cannot aim, a refusal that arrives before the
bytes move, and a signed URL that expires.

The local store is exercised in full because it needs no container; the object
store's own behaviour is the S3 protocol's and is asserted end to end by the
`files` suite against the running MinIO.
"""

from __future__ import annotations

import time

import pytest

from src.core import storage
from src.core.errors import ValidationError


@pytest.fixture()
def local(tmp_path):
    return storage.LocalStorage(str(tmp_path), secret="test-secret", prefix="/platform")


def test_a_key_is_built_from_segments_and_never_from_a_path():
    assert storage.key_for("files", "reports", "a.pdf") == "files/reports/a.pdf"
    # Leading and trailing slashes are segment noise, not structure.
    assert storage.key_for("/files/", "/reports/") == "files/reports"
    with pytest.raises(ValidationError):
        storage.key_for("", "  ")
    # And a relative segment is refused where every key in the platform is
    # built, rather than only where one store happens to resolve a path.
    with pytest.raises(ValidationError):
        storage.key_for("files", "..", "secrets")


def test_a_traversal_never_leaves_the_store(local):
    """A key is generated, but a store that trusts its input is one `../` away
    from serving something it does not own."""
    with pytest.raises(ValidationError):
        local.put("../escaped.txt", b"nope", content_type="text/plain")


def test_the_extension_decides_the_type_not_the_client():
    """A client that says `image/png` about a `.sh` is confused or trying
    something; the extension is what a later reader acts on."""
    assert storage.content_type_for("notes.md", "application/octet-stream") == "text/markdown"
    assert storage.content_type_for("mystery", "text/csv") == "text/csv"
    assert storage.content_type_for("mystery") == "application/octet-stream"


def test_an_unacceptable_upload_is_refused_before_a_url_is_issued():
    """After 400 MB have moved is the wrong moment to say no (§29)."""
    with pytest.raises(ValidationError) as refusal:
        storage.refuse_unacceptable("payload.sh", 10)
    assert "sh" in refusal.value.details["extension"]

    with pytest.raises(ValidationError) as too_big:
        storage.refuse_unacceptable("archive.csv", storage.MAX_UPLOAD_BYTES + 1)
    assert too_big.value.details["maximum"] == storage.MAX_UPLOAD_BYTES

    # And an ordinary file passes without ceremony.
    storage.refuse_unacceptable("report.pdf", 1024)


def test_the_local_store_round_trips_and_reports_what_it_holds(local):
    key = storage.key_for("files", "note.txt")
    stored = local.put(key, b"twelve bytes", content_type="text/plain")

    assert stored.size_bytes == 12
    assert local.get(key) == b"twelve bytes"
    assert local.stat(key) is not None
    assert local.stat(key).checksum == stored.checksum

    local.delete(key)
    assert local.stat(key) is None
    with pytest.raises(Exception):
        local.get(key)


def test_a_local_url_is_signed_and_expires(local):
    key = storage.key_for("files", "note.txt")
    signed = local.download_url(key, filename="my notes.txt")

    assert signed.method == "GET"
    assert "signature=" in signed.url
    # The name the person gave it, so the browser saves it under that rather
    # than under the generated key.
    assert "filename=my%20notes.txt" in signed.url

    expires_at = int(time.time()) + 60
    local.verify(key, expires_at, local.sign(key, expires_at))

    with pytest.raises(ValidationError):
        local.verify(key, expires_at, "not-the-signature")
    with pytest.raises(ValidationError):
        # Expired, however good the signature.
        past = int(time.time()) - 1
        local.verify(key, past, local.sign(key, past))


def test_a_signature_is_specific_to_its_key(local):
    """Otherwise one valid link is a valid link to everything."""
    expires_at = int(time.time()) + 60
    with pytest.raises(ValidationError):
        local.verify("files/other.txt", expires_at, local.sign("files/note.txt", expires_at))


def test_the_seeded_bodies_are_the_formats_they_claim_to_be():
    """A `.pdf` whose bytes are plain text is a file that fails in the reader
    somebody opens it with, which is worse than not offering it."""
    from src.seed import blobs
    from src.seed import catalog

    for extension, _mime, _kind in catalog.FILE_TYPES:
        body = blobs.body_for(f"Quarterly report.{extension}", extension, "/finance", None)
        assert body, extension

    assert blobs.body_for("a.pdf", "pdf", "/f", None).startswith(b"%PDF-")
    assert blobs.body_for("a.png", "png", "/f", None).startswith(b"\x89PNG\r\n\x1a\n")
    assert b"<svg" in blobs.body_for("a.svg", "svg", "/f", None)

    import json as json_module

    parsed = json_module.loads(blobs.body_for("a.json", "json", "/finance", None))
    assert parsed["folder"] == "/finance"

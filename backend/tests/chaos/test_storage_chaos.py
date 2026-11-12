"""MinIO (object storage) refused or hung: file pages degrade, nothing hangs.

The file *list* is rows in PostgreSQL and needs no storage at all; only the
operations that touch bytes do. What an outage used to do: botocore's defaults
(60 s connect timeout, several retries) held a download request for minutes,
then `EndpointConnectionError` — a `BotoCoreError`, not the `ClientError` the
code caught — surfaced as a 500; `stat` could not tell "not there" from
"cannot ask"; and `ensure_bucket` at first use raised, so even the folder tree
(which only names the store) failed.
"""

from __future__ import annotations

import pytest

from src.config import Config
from src.core import storage
from src.core.errors import ServiceUnavailableError
from tests.chaos.conftest import REFUSED_HOST, REFUSED_PORT, Stopwatch
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX


def _store(endpoint: str) -> storage.ObjectStorage:
    return storage.ObjectStorage(endpoint=endpoint, bucket="nucleus-chaos", access_key="x", secret_key="y")


@pytest.fixture(params=["refused", "hung"])
def broken_store(request, black_hole, monkeypatch):
    if request.param == "refused":
        endpoint = f"http://{REFUSED_HOST}:{REFUSED_PORT}"
    else:
        endpoint = f"http://127.0.0.1:{black_hole.port}"
        # The hung case waits out the read timeout; keep the suite quick.
        monkeypatch.setattr(storage, "READ_TIMEOUT_SECONDS", 1)
        monkeypatch.setattr(storage, "CONNECT_TIMEOUT_SECONDS", 1)
    return _store(endpoint)


def test_building_the_store_does_not_fail_when_storage_is_down(broken_store):
    with Stopwatch() as watch:
        broken_store.ensure_bucket()
    assert watch.seconds < 10


@pytest.mark.parametrize("operation", ["stat", "get", "delete", "put"])
def test_byte_operations_say_unavailable_quickly(broken_store, operation):
    with Stopwatch() as watch, pytest.raises(ServiceUnavailableError) as raised:
        if operation == "put":
            broken_store.put("chaos/key", b"bytes", content_type="text/plain")
        else:
            getattr(broken_store, operation)("chaos/key")
    assert raised.value.details["dependency"] == "storage"
    assert watch.seconds < 10, f"{operation} held for {watch.seconds:.1f}s"


def test_presigning_needs_no_network(broken_store):
    """Upload and download URLs are signed locally — available during an outage."""
    assert broken_store.upload_url("chaos/key", content_type="text/plain").url.startswith("http")
    assert broken_store.download_url("chaos/key", filename="a.txt").method == "GET"


def test_health_reports_the_outage(broken_store):
    assert broken_store.health()["status"] == "unavailable"


@pytest.mark.database
def test_the_files_pages_degrade_gracefully(client, monkeypatch):
    """The list and the tree answer; a download is a clean 503 envelope."""
    monkeypatch.setattr(storage, "_store", _store(f"http://{REFUSED_HOST}:{REFUSED_PORT}"))
    monkeypatch.setattr("src.core.auth.verify_token", lambda _t: persona_claims("admin", "administrator",
                                                                                  sid="chaos-storage"))
    headers = {"Authorization": "Bearer chaos"}

    listing = client.get(f"{PREFIX}/api/files?page_size=10&status=READY", headers=headers)
    assert listing.status_code == 200
    assert client.get(f"{PREFIX}/api/files/tree", headers=headers).status_code == 200

    ready = [f for f in listing.get_json()["items"] if f.get("status") == "READY"]
    if not ready:
        pytest.skip("no READY file seeded to download")
    with Stopwatch() as watch:
        download = client.get(f"{PREFIX}/api/files/{ready[0]['id']}", headers=headers)
    assert watch.seconds < 10
    if download.status_code == 200 and "download" not in (download.get_json() or {}):
        pytest.skip("the file detail does not touch storage")
    assert download.status_code == 503, download.get_data(as_text=True)[:300]
    body = download.get_json()
    assert body["error"] == "service_unavailable" and body["details"]["dependency"] == "storage"

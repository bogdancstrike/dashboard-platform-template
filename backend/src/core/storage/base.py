"""Storage limits, signed URLs, stored objects, and the Storage interface."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, BinaryIO, Protocol

from src.core.errors import ServiceUnavailableError

#: How long the API waits on object storage. botocore's defaults are a 60 s
#: connect timeout and several retries, so with MinIO down a download link sat
#: for minutes and then failed as a 500 (docs/testing/chaos.md).
CONNECT_TIMEOUT_SECONDS = 3


READ_TIMEOUT_SECONDS = 15


def _unreachable(exc: Exception) -> ServiceUnavailableError:
    return ServiceUnavailableError(
        "File storage is not answering right now. Try again in a moment.",
        details={"dependency": "storage", "reason": type(exc).__name__},
    )


#: How long a presigned URL is good for. Long enough to pick a file and upload
#: it on a slow connection; short enough that a URL pasted into a chat is not a
#: permanent grant.
URL_TTL_SECONDS = 900


#: The largest object this platform will sign an upload for. Refused before the
#: URL is issued rather than after 400 MB have been transferred (§29).
MAX_UPLOAD_BYTES = 512 * 1024 * 1024


#: Extensions this platform will not accept, whatever the client calls them.
#: A deny list rather than an allow list because a document platform's job is
#: to hold documents nobody predicted, and the risk here is execution — which
#: is a property of a handful of extensions.
REFUSED_EXTENSIONS = frozenset({
    "exe", "dll", "so", "dylib", "bat", "cmd", "com", "scr", "msi",
    "sh", "bash", "zsh", "ps1", "jar", "app",
})


@dataclass(frozen=True, slots=True)
class SignedUrl:
    """A URL somebody may use once, and what to do with it."""

    url: str
    method: str
    expires_in: int
    #: Headers the client must send with the request for the signature to hold.
    headers: dict[str, str]


@dataclass(frozen=True, slots=True)
class StoredObject:
    """What the store knows about one blob."""

    key: str
    size_bytes: int
    content_type: str
    checksum: str


class Storage(Protocol):
    """The four questions anything above this module may ask."""

    #: How this store describes itself in the health endpoint.
    name: str

    def upload_url(self, key: str, *, content_type: str) -> SignedUrl: ...
    def download_url(self, key: str, *, filename: str = "", inline: bool = False) -> SignedUrl: ...
    def put(self, key: str, stream: BinaryIO | bytes, *, content_type: str) -> StoredObject: ...
    def get(self, key: str) -> bytes: ...
    def stat(self, key: str) -> StoredObject | None: ...
    def delete(self, key: str) -> None: ...
    def health(self) -> dict[str, Any]: ...

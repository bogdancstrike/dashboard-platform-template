"""Where the bytes live, behind one interface (§20, §29, §30).

Files, imports and exports all need the same three things: put a blob
somewhere, get it back, and hand somebody a URL that lets them do either
*without the bytes passing through this process*. That last one is the whole
design. An API that streams a 400 MB upload through a gevent worker is an API
whose worker is unavailable for the duration, and a download that proxies
through Flask is a download that costs the same worker again.

So the interface is presigned-URL-first: `upload_url` and `download_url` are
the primary operations, and `put`/`get` exist for the small server-side cases
(a generated export, a checksum) rather than as the way files normally move.

Two implementations, chosen by configuration:

**`ObjectStorage`** talks S3 — MinIO in the compose stack, and any S3-compatible
service in a deployment. It is the real one.

**`LocalStorage`** writes to a directory and signs its own URLs with the
application's secret. It exists so `python main.py` works with nothing else
running, and so the test suite does not need a container. It is not a lesser
implementation of the same thing pretending to be S3: it answers the same four
questions and says plainly that its URLs are served by this process.

`for_config()` picks between them, and nothing above this module knows which
it got.
"""

from __future__ import annotations

import hashlib
import hmac
import mimetypes
import os
import pathlib
import time
from dataclasses import dataclass
from typing import Any, BinaryIO, Protocol
from urllib.parse import quote

from src.config import Config
from src.core.errors import NotFoundError, ValidationError

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
    def download_url(self, key: str, *, filename: str = "") -> SignedUrl: ...
    def put(self, key: str, stream: BinaryIO | bytes, *, content_type: str) -> StoredObject: ...
    def get(self, key: str) -> bytes: ...
    def stat(self, key: str) -> StoredObject | None: ...
    def delete(self, key: str) -> None: ...
    def health(self) -> dict[str, Any]: ...


# ── keys and names ───────────────────────────────────────────────────────


def key_for(*parts: str) -> str:
    """A storage key from path segments, with nothing a client chose in it.

    The name a person gave a file is metadata in PostgreSQL; the key is
    generated. A key built from user input is a key somebody can aim at
    somebody else's object with `../`, and sanitising a path is a game nobody
    wins twice.
    """
    cleaned = [segment.strip().strip("/").strip() for segment in parts]
    cleaned = [segment for segment in cleaned if segment]
    if not cleaned:
        raise ValidationError("A storage key needs at least one segment.")
    # Belt and braces at the key level as well as in the local store's path
    # resolution: a key is generated here, but this function is the one place
    # every key in the platform is built, so it is the cheapest place to make
    # a traversal impossible rather than merely unlikely.
    if any(segment in ("..", ".") for segment in cleaned):
        raise ValidationError(
            "A storage key segment cannot be a relative path.",
            details={"segments": cleaned},
        )
    return "/".join(cleaned)


def extension_of(filename: str) -> str:
    return (pathlib.PurePosixPath(filename).suffix or "").lstrip(".").lower()


def content_type_for(filename: str, declared: str = "") -> str:
    """What the bytes are, preferring the name over what the client claimed.

    A client that says `image/png` about a `.sh` is either confused or trying
    something; the extension is the thing a later reader will act on.
    """
    guessed, _encoding = mimetypes.guess_type(filename)
    return guessed or declared or "application/octet-stream"


def refuse_unacceptable(filename: str, size_bytes: int) -> None:
    """Say no before a URL is issued, not after the bytes have moved."""
    extension = extension_of(filename)
    if extension in REFUSED_EXTENSIONS:
        raise ValidationError(
            "That kind of file is not accepted here.",
            details={"extension": extension, "refused": sorted(REFUSED_EXTENSIONS)},
        )
    if size_bytes < 0 or size_bytes > MAX_UPLOAD_BYTES:
        raise ValidationError(
            f"A file may be at most {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
            details={"size_bytes": size_bytes, "maximum": MAX_UPLOAD_BYTES},
        )


# ── S3 / MinIO ───────────────────────────────────────────────────────────


class ObjectStorage:
    """S3-compatible object storage. MinIO in the compose stack.

    The client is built once and reused: boto3 signs locally, so a presigned
    URL costs no network call at all — which is what makes handing one out per
    file in a drag-and-drop of forty acceptable.
    """

    name = "object"

    def __init__(
        self,
        *,
        endpoint: str,
        bucket: str,
        access_key: str,
        secret_key: str,
        region: str = "us-east-1",
        public_endpoint: str = "",
    ) -> None:
        import boto3
        from botocore.config import Config as BotoConfig

        self._bucket = bucket

        def client_for(address: str):
            return boto3.client(
                "s3",
                endpoint_url=address,
                aws_access_key_id=access_key,
                aws_secret_access_key=secret_key,
                region_name=region,
                # Path-style addressing: `bucket.minio:9000` is not a hostname
                # that resolves, and virtual-host style is the boto3 default.
                config=BotoConfig(signature_version="s3v4", s3={"addressing_style": "path"}),
            )

        # Two clients, for the same reason Keycloak needs two URLs: the API
        # reaches MinIO over the compose network, and the *browser* has to
        # reach it on an address that exists outside Docker.
        #
        # Two *clients* rather than one and a string substitution, because an
        # SigV4 signature covers the Host header — rewriting the host of a
        # signed URL is how the first version of this produced
        # `SignatureDoesNotMatch` on every download. The presigner has to sign
        # for the address the browser will actually send.
        self._client = client_for(endpoint)
        self._signer = client_for(public_endpoint) if public_endpoint else self._client

    def ensure_bucket(self) -> None:
        """Create the bucket if it is not there. Idempotent, and safe to call
        on every boot — which is what makes a fresh volume just work."""
        from botocore.exceptions import ClientError

        try:
            self._client.head_bucket(Bucket=self._bucket)
        except ClientError:
            try:
                self._client.create_bucket(Bucket=self._bucket)
            except ClientError:
                # Another worker won the race, or the credentials cannot create
                # buckets in this deployment. Either way the caller finds out
                # on the first real operation, with a real error.
                pass

    def _signed(self, operation: str, params: dict[str, Any], method: str) -> SignedUrl:
        url = self._signer.generate_presigned_url(
            operation, Params=params, ExpiresIn=URL_TTL_SECONDS, HttpMethod=method,
        )
        return SignedUrl(
            url=url,
            method=method,
            expires_in=URL_TTL_SECONDS,
            headers={"Content-Type": str(params.get("ContentType", ""))} if method == "PUT" else {},
        )

    def upload_url(self, key: str, *, content_type: str) -> SignedUrl:
        return self._signed(
            "put_object",
            {"Bucket": self._bucket, "Key": key, "ContentType": content_type},
            "PUT",
        )

    def download_url(self, key: str, *, filename: str = "") -> SignedUrl:
        params: dict[str, Any] = {"Bucket": self._bucket, "Key": key}
        if filename:
            # So the browser saves it under the name the person gave it rather
            # than under the generated key.
            params["ResponseContentDisposition"] = (
                f'attachment; filename="{quote(filename)}"'
            )
        return self._signed("get_object", params, "GET")

    def put(self, key: str, stream: BinaryIO | bytes, *, content_type: str) -> StoredObject:
        body = stream if isinstance(stream, bytes) else stream.read()
        self._client.put_object(
            Bucket=self._bucket, Key=key, Body=body, ContentType=content_type
        )
        return StoredObject(key, len(body), content_type, hashlib.sha256(body).hexdigest())

    def get(self, key: str) -> bytes:
        from botocore.exceptions import ClientError

        try:
            response = self._client.get_object(Bucket=self._bucket, Key=key)
        except ClientError as exc:
            raise NotFoundError("That file is not in storage.", details={"key": key}) from exc
        return bytes(response["Body"].read())

    def stat(self, key: str) -> StoredObject | None:
        from botocore.exceptions import ClientError

        try:
            head = self._client.head_object(Bucket=self._bucket, Key=key)
        except ClientError:
            return None
        return StoredObject(
            key,
            int(head.get("ContentLength") or 0),
            str(head.get("ContentType") or "application/octet-stream"),
            str(head.get("ETag") or "").strip('"'),
        )

    def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=key)

    def health(self) -> dict[str, Any]:
        from botocore.exceptions import BotoCoreError, ClientError

        started = time.perf_counter()
        try:
            self._client.head_bucket(Bucket=self._bucket)
        except (ClientError, BotoCoreError) as exc:
            return {"status": "unavailable", "latency_ms": None, "error": str(exc)[:200]}
        return {
            "status": "healthy",
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
            "bucket": self._bucket,
        }


# ── the local fallback ───────────────────────────────────────────────────


class LocalStorage:
    """A directory, with URLs this process serves and signs itself.

    Here so `python main.py` works with nothing else running and so the test
    suite needs no container. It answers the same four questions and is honest
    about the difference: its URLs are served by this API, so the bytes *do*
    pass through the process. That is a trade a developer makes knowingly on a
    laptop and nobody should make in a deployment — which is why the health
    endpoint reports which store is in use.
    """

    name = "local"

    def __init__(self, root: str, *, secret: str, prefix: str) -> None:
        self._root = pathlib.Path(root)
        self._secret = secret.encode()
        self._prefix = prefix.rstrip("/")
        self._root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> pathlib.Path:
        # Resolved and checked against the root: a key is generated by
        # `key_for`, but a store that trusts its input is one traversal away
        # from serving `/etc/passwd`.
        target = (self._root / key).resolve()
        if not str(target).startswith(str(self._root.resolve())):
            raise ValidationError("That storage key is not inside the store.")
        return target

    def sign(self, key: str, expires_at: int) -> str:
        """The signature a local URL carries, so it expires like a real one."""
        message = f"{key}:{expires_at}".encode()
        return hmac.new(self._secret, message, hashlib.sha256).hexdigest()[:32]

    def verify(self, key: str, expires_at: int, signature: str) -> None:
        if expires_at < int(time.time()):
            raise ValidationError("That link has expired. Ask for a new one.")
        if not hmac.compare_digest(self.sign(key, expires_at), signature):
            raise ValidationError("That link is not valid.")

    def _url(self, key: str, method: str, filename: str = "") -> SignedUrl:
        expires_at = int(time.time()) + URL_TTL_SECONDS
        query = f"expires={expires_at}&signature={self.sign(key, expires_at)}"
        if filename:
            query += f"&filename={quote(filename)}"
        return SignedUrl(
            url=f"{self._prefix}/api/files/blob/{quote(key)}?{query}",
            method=method,
            expires_in=URL_TTL_SECONDS,
            headers={},
        )

    def upload_url(self, key: str, *, content_type: str) -> SignedUrl:
        del content_type  # The local store takes whatever arrives.
        return self._url(key, "PUT")

    def download_url(self, key: str, *, filename: str = "") -> SignedUrl:
        return self._url(key, "GET", filename)

    def put(self, key: str, stream: BinaryIO | bytes, *, content_type: str) -> StoredObject:
        body = stream if isinstance(stream, bytes) else stream.read()
        target = self._path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
        return StoredObject(key, len(body), content_type, hashlib.sha256(body).hexdigest())

    def get(self, key: str) -> bytes:
        target = self._path(key)
        if not target.is_file():
            raise NotFoundError("That file is not in storage.", details={"key": key})
        return target.read_bytes()

    def stat(self, key: str) -> StoredObject | None:
        target = self._path(key)
        if not target.is_file():
            return None
        body = target.read_bytes()
        return StoredObject(
            key,
            len(body),
            content_type_for(key),
            hashlib.sha256(body).hexdigest(),
        )

    def delete(self, key: str) -> None:
        target = self._path(key)
        if target.is_file():
            target.unlink()

    def health(self) -> dict[str, Any]:
        writable = os.access(self._root, os.W_OK)
        return {
            "status": "healthy" if writable else "unavailable",
            "latency_ms": 0.0,
            "path": str(self._root),
        }


# ── selection ────────────────────────────────────────────────────────────

_store: Storage | None = None


def for_config(*, reset: bool = False) -> Storage:
    """The store this deployment is configured for, built once.

    Object storage when an endpoint is configured, the local directory
    otherwise. Nothing above this module knows which it got — which is the
    point of the interface, and what makes swapping MinIO for S3 a change to
    the environment rather than to the code.
    """
    global _store
    if _store is not None and not reset:
        return _store

    if Config.STORAGE_ENDPOINT:
        store = ObjectStorage(
            endpoint=Config.STORAGE_ENDPOINT,
            bucket=Config.STORAGE_BUCKET,
            access_key=Config.STORAGE_ACCESS_KEY,
            secret_key=Config.STORAGE_SECRET_KEY,
            region=Config.STORAGE_REGION,
            public_endpoint=Config.STORAGE_PUBLIC_ENDPOINT,
        )
        store.ensure_bucket()
        _store = store
    else:
        _store = LocalStorage(
            Config.STORAGE_DIR, secret=Config.SECRET_KEY, prefix=Config.API_PREFIX
        )
    return _store

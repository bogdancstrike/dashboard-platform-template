"""S3/MinIO storage."""

from __future__ import annotations

import hashlib
import time
from typing import Any, BinaryIO
from urllib.parse import quote

from src.core.errors import NotFoundError
from src.core.storage.base import (
    CONNECT_TIMEOUT_SECONDS,
    READ_TIMEOUT_SECONDS,
    URL_TTL_SECONDS,
    SignedUrl,
    StoredObject,
    _unreachable,
)


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
                config=BotoConfig(
                    signature_version="s3v4", s3={"addressing_style": "path"},
                    connect_timeout=CONNECT_TIMEOUT_SECONDS, read_timeout=READ_TIMEOUT_SECONDS,
                    retries={"max_attempts": 2, "mode": "standard"},
                ),
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
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            self._client.head_bucket(Bucket=self._bucket)
        except BotoCoreError:
            # Unreachable right now. Not fatal: the files pages still list
            # what the database knows, and the first operation that needs the
            # bytes says storage is unavailable (a 503), instead of every page
            # that merely names the store failing.
            return
        except ClientError:
            try:
                self._client.create_bucket(Bucket=self._bucket)
            except (ClientError, BotoCoreError):
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

    def download_url(self, key: str, *, filename: str = "", inline: bool = False) -> SignedUrl:
        params: dict[str, Any] = {"Bucket": self._bucket, "Key": key}
        if filename:
            # So the browser saves it under the name the person gave it rather
            # than under the generated key — or *shows* it under that name,
            # when the caller wants a preview rather than a download (§20).
            # The disposition is the only difference between the two: the same
            # object, the same signature, one word.
            disposition = "inline" if inline else "attachment"
            params["ResponseContentDisposition"] = (
                f'{disposition}; filename="{quote(filename)}"'
            )
        return self._signed("get_object", params, "GET")

    def put(self, key: str, stream: BinaryIO | bytes, *, content_type: str) -> StoredObject:
        from botocore.exceptions import BotoCoreError

        body = stream if isinstance(stream, bytes) else stream.read()
        try:
            self._client.put_object(
                Bucket=self._bucket, Key=key, Body=body, ContentType=content_type
            )
        except BotoCoreError as exc:
            raise _unreachable(exc) from exc
        return StoredObject(key, len(body), content_type, hashlib.sha256(body).hexdigest())

    def get(self, key: str) -> bytes:
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            response = self._client.get_object(Bucket=self._bucket, Key=key)
            return bytes(response["Body"].read())
        except ClientError as exc:
            raise NotFoundError("That file is not in storage.", details={"key": key}) from exc
        except BotoCoreError as exc:
            raise _unreachable(exc) from exc

    def stat(self, key: str) -> StoredObject | None:
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            head = self._client.head_object(Bucket=self._bucket, Key=key)
        except ClientError:
            return None
        except BotoCoreError as exc:
            # Unreachable is not "not there": answering None would tell the
            # reader their file is gone, when storage is merely down.
            raise _unreachable(exc) from exc
        return StoredObject(
            key,
            int(head.get("ContentLength") or 0),
            str(head.get("ContentType") or "application/octet-stream"),
            str(head.get("ETag") or "").strip('"'),
        )

    def delete(self, key: str) -> None:
        from botocore.exceptions import BotoCoreError

        try:
            self._client.delete_object(Bucket=self._bucket, Key=key)
        except BotoCoreError as exc:
            raise _unreachable(exc) from exc

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

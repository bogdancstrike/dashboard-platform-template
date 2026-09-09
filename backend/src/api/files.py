"""The file manager (§20).

Presigned-URL-first: this module hands out URLs and records what happened, and
the bytes go straight between the browser and object storage. See
`services/files.py` for why the upload is two phases, and `core/storage.py`
for the interface that makes MinIO and S3 the same code path.

The one endpoint that *does* move bytes is `blob`, and it exists only for the
local-directory store — the fallback that lets `python main.py` work with
nothing else running. Against object storage it is never called, and it says
so rather than pretending to own keys it has never seen. Its credential is the
signature in the URL, because a browser following a link cannot add a header.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.core.errors import NotFoundError, ValidationError
from src.services import files as service


@requires("files.view")
def tree(app=None, operation: str = "", request=None, **_: Any):
    """Every folder, what is in it, and what this reader may do."""
    with session_scope() as session:
        return service.tree(session, principal=me()), 200


@requires("files.view")
def collection(app=None, operation: str = "", request=None, **_: Any):
    """The files in one folder, or a place to put a new one."""
    method = (request.method if request is not None else "GET").upper()
    with session_scope() as session:
        if method == "POST":
            return service.begin_upload(session, json_body(), principal=me()), 201
        args = request.args.to_dict() if request is not None else {}
        return service.listing(session, args, principal=me()), 200


@requires("files.view")
def item(app=None, operation: str = "", request=None, file_id: str = "", **kwargs: Any):
    """One file: rename it, move it, or remove it."""
    identifier = file_id or str(kwargs.get("file_id") or "")
    method = (request.method if request is not None else "GET").upper()
    with session_scope() as session:
        principal = me()
        if method == "PUT":
            return service.update(session, identifier, json_body(), principal=principal), 200
        if method == "DELETE":
            return service.remove(session, identifier, principal=principal), 200
        # `?inline=true` asks for the same object framed for showing rather
        # than saving — the preview pane (§20, §64).
        inline = str((request.args.get("inline") if request is not None else "") or "").lower() in (
            "1",
            "true",
            "yes",
        )
        return (
            service.download_url(session, identifier, principal=principal, inline=inline),
            200,
        )


@requires("files.manage")
def confirm(app=None, operation: str = "", request=None, file_id: str = "", **kwargs: Any):
    """The bytes are there — checked, not taken on trust."""
    identifier = file_id or str(kwargs.get("file_id") or "")
    with session_scope() as session:
        return service.confirm_upload(session, identifier, principal=me()), 200


def blob(app=None, operation: str = "", request=None, **_: Any):
    """Serve one object from the *local* store to the holder of a signed link.

    **Public by design and by necessity.** The signature in the URL is the
    credential, exactly as it is for a presigned S3 URL: a browser following a
    link — an `<img>`, an `<iframe>`, a download — cannot add a bearer header,
    which is the whole reason presigned URLs exist.
    `tests/test_endpoint_map.PUBLIC` records it with that reason, so the
    exemption is a decision somebody took rather than a decorator somebody
    forgot.

    Only the local store hands out these URLs. Against MinIO or S3 the bytes
    never come near this process and this is never called — which is why it
    refuses when object storage is configured rather than pretending to own
    keys it has never seen.

    It exists because the module docstring has promised it since it was
    written and nothing served it: with no `STORAGE_ENDPOINT` — which is how
    `make dev-api` runs — every download and every preview was a 404 at a URL
    the API had signed itself.
    """
    from flask import Response

    from src.core import storage

    args = request.args if request is not None else {}
    key = str(args.get("key") or "")
    signature = str(args.get("signature") or "")
    try:
        expires_at = int(args.get("expires") or 0)
    except (TypeError, ValueError) as exc:
        raise ValidationError("That link is not valid.") from exc
    if not key or not signature:
        raise ValidationError("That link is not valid.")

    store = storage.for_config()
    verify = getattr(store, "verify", None)
    if verify is None:
        raise NotFoundError(
            "This deployment serves files from object storage, not from here.",
            details={"store": getattr(store, "name", "unknown")},
        )

    # Expiry and signature, in that order, both from the store that signed it.
    verify(key, expires_at, signature)
    body = store.get(key)

    name = str(args.get("filename") or key.rsplit("/", 1)[-1])
    shown = str(args.get("inline") or "").lower() in ("1", "true", "yes")
    return Response(
        body,
        mimetype=storage.content_type_for(name),
        headers={
            "Content-Disposition": f'{"inline" if shown else "attachment"}; filename="{name}"',
            # A signed link is a capability with an expiry; a cache that
            # outlived it would serve the object after the link stopped
            # working, which is the one thing the expiry is for.
            "Cache-Control": "private, max-age=60",
        },
    )


@requires("files.view")
def folders(app=None, operation: str = "", request=None, **_: Any):
    """Create a folder."""
    with session_scope() as session:
        return service.create_folder(session, json_body(), principal=me()), 201


@requires("files.manage")
def folder(app=None, operation: str = "", request=None, folder_id: str = "", **kwargs: Any):
    """Remove an empty folder."""
    identifier = folder_id or str(kwargs.get("folder_id") or "")
    with session_scope() as session:
        return service.remove_folder(session, identifier, principal=me()), 200

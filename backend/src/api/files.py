"""The file manager (§20).

Presigned-URL-first: this module hands out URLs and records what happened, and
the bytes go straight between the browser and object storage. See
`services/files.py` for why the upload is two phases, and `core/storage.py`
for the interface that makes MinIO and S3 the same code path.

The one endpoint that *does* move bytes is `blob`, and it exists only for the
local-directory store — the fallback that lets `python main.py` work with
nothing else running. Against object storage it is never called.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
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
        return service.download_url(session, identifier, principal=principal), 200


@requires("files.manage")
def confirm(app=None, operation: str = "", request=None, file_id: str = "", **kwargs: Any):
    """The bytes are there — checked, not taken on trust."""
    identifier = file_id or str(kwargs.get("file_id") or "")
    with session_scope() as session:
        return service.confirm_upload(session, identifier, principal=me()), 200


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

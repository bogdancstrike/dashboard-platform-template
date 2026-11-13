# `src/core/storage`

Where the bytes live, behind one interface (§20, §29, §30).

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

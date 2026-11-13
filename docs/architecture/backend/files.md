# The file manager (§20)

The file manager (§20).

One decision shapes this whole module: **the bytes never pass through the API**.
A browser asks for a presigned URL, uploads straight to object storage, and
then tells the API it is done; a download is a presigned URL the browser
follows itself. An API that streams a 400 MB upload through a gevent worker is
an API whose worker is gone for the duration of it.

That has a consequence worth stating plainly: the API *cannot know* whether the
upload happened. So a file is created in two phases — a row in `UPLOADING`
alongside the URL, and a confirmation that checks the object is actually there
with `stat` before flipping it to `READY`. Trusting the client's "done" would
mean a file list full of rows with nothing behind them, which is worse than an
upload that visibly failed.

Everything else follows the platform's existing shapes: folders are a
materialised-path tree so a breadcrumb is one row read, listing is
`core/pagination`, permissions are `files.view` to read and `files.manage` to
change, and every mutation is audited.

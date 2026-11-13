# The assistant (§41): conversations with history, and one streamed turn

The assistant (§41): conversations with history, and one streamed turn.

A conversation belongs to one person and is readable by nobody else. Each has
a mode — ``general`` (a plain assistant) or ``data`` (it may call the
read-only tools in `assistant_tools`, with its owner's permissions) — that can
be switched between turns; every message records the mode it was written in.

A turn is streamed as server-sent events:

    event: start   data: {"message_id": …, "user_message": {…}}
    event: delta   data: {"text": "…"}
    event: tool    data: {"name": …, "summary": …}
    event: done    data: {"message": {…}}          (the saved assistant turn)
    event: error   data: {"message": "…", "code": …}

If the reader stops it — closes the request — the words already written are
saved with status ``stopped``, so the history shows what they saw.

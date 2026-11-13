# Files, folders, the mailbox, comments and tags

Files, folders, the mailbox, comments and tags.

The mailbox is threads *and* messages, because threading is the only thing that
makes an inbox screen non-trivial and therefore the only reason to have one in
a template. Messages within a thread are appended in send order and reply to
the message before them, so `in_reply_to` never points at a row that does not
exist yet.

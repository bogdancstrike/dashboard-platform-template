# Team chat: channels, direct messages, unread counts and search (§47)

Team chat: channels, direct messages, unread counts and search (§47).

A channel's *messages* are comments (`services/comments.py`, resource type
`chat_channel`) — mentions, replies, reactions, attachments, edit and delete
are the record thread's rules, written once. What lives here is the room:

* **Who may read.** A public channel is readable by anybody with `chat.use`;
  a private channel or a direct conversation by its members only. A channel
  somebody may not read is *not found*, never "forbidden": saying a private
  room exists is itself a disclosure.
* **Who may write.** Members. Posting in a public channel one has not joined
  joins it, which is what people expect from every chat tool they have used.
* **What is unread.** Lines by other people after the reader's marker
  (`thread_reads`), or after they joined when they have never opened it.

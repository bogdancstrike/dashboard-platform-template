# Document knowledge

Ask your documents (§44): collections, their files, and questions with citations.

**Who sees what.** A collection has the platform's one sharing model
(`core/sharing`): private to its owner, shared with named people, or public.
Every read below starts from that predicate, so a question can only ever be
answered from passages of collections its asker may see — retrieval filters on
the visible collection ids in SQL, not on the result afterwards.

**Where the files live.** A collection's uploads are ordinary files of the
file manager, in a folder of their own under `/Knowledge`, so they can be
previewed, downloaded and moved like any other. A collection can also take a
file that is already there. What the collection adds is the reading:
`services/knowledge_ingest` turns each file into passages with their page and
position, and this module asks questions of them.

**How an answer is made.** Retrieval is hybrid: the question's embedding
against the passages' (cosine, exact) and PostgreSQL full-text search, fused
by reciprocal rank — so a passage that uses the question's words is found
even where embeddings are unavailable, and one that answers it in other words
is found by meaning. The model sees numbered sources and must cite them as
`[n]`; the answer's citations are exactly the sources it cited, renumbered in
the order they first appear, each with the file, the page and the boxes to
mark. An answer that cites nothing it was given says so rather than pretend.

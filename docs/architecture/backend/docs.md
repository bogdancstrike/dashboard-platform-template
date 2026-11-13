# The wiki

The wiki: spaces, a tree of pages, blocks, history and links (§48–49).

Five decisions worth stating.

**A page is a list of blocks, saved whole.** The same shape the report builder
composes (`HEADING`/`TEXT`/`CHART`/`REPORT` in its vocabulary; lower-case here
because a wiki has many more kinds of words than a report). Saving the whole
list is what makes history simple: a revision is a copy, and restoring is
saving an old copy as the newest one.

**History is kept per save, but a burst of saves is one revision.** The editor
saves as somebody types; fifty revisions for one paragraph is a history nobody
can read. A save by the same person within `COALESCE_MINUTES` of their last
revision rewrites that revision rather than adding one.

**A record mentioned in a page links the page to it.** Record blocks are
reconciled into `doc_links` on every save, beside the links added by hand, so
a ticket can list "pages about this ticket" with an index lookup.

**Meeting notes are pages.** "Take notes" on a calendar event files a page in
the Meetings space, pre-filled with who was invited and what the event said
it was about. Action items in it are blocks that become real tasks on request.

**A move never makes a loop.** Dropping a page under its own descendant is
refused, because the tree view would otherwise lose a branch for good.

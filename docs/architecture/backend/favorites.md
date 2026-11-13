# Bookmarks and recents — one store for "what have I starred" (§38, §39)

Bookmarks and recents — one store for "what have I starred" (§38, §39).

There were two, and the older UI already lied about it. The saved-search
drawer's own tooltip says **"Add to favourites"** and wrote
`SavedSearch.is_favorite`; the reports page did the same with
`Report.is_favorite`; and `favorites` — a table whose docstring reads "a
bookmark on anything addressable" — had no service at all. So a reader could
star a saved search, be told it went to their favourites, open `/favorites`
and find nothing. Two stores for one fact, and the fact people would act on
was in whichever one they had not looked at.

This module is the single store. Six decisions worth stating.

**A star is a `Favorite` row, whatever was starred.** Which means one query
answers "what have I bookmarked" across saved searches, reports, records and
anything else addressable — and adding a bookmarkable thing is a call to
`set_favorite`, not a new boolean column.

**`is_favorite` stays in the API and stops being stored.** The reports and
saved-search endpoints still publish and accept it, because their pages are
built on it and a field that vanished would be a needless break; it is now
read from and written to *this* store. `is_favorite_of` answers one row and
`favorite_ids` answers a whole page in one query, because the alternative is
a lookup per item.

**The old columns are migrated once and then cleared.** `--sync-favorites`
copies them into `Favorite` rows and sets them false, so `is_favorite = false`
everywhere is the steady state and `--check` can assert exactly that. Keeping
them in sync would be maintaining the second store this module exists to
remove.

**Nothing needs a permission.** These are your own bookmarks, and being signed
in is the qualification — the same argument `/settings/security` makes.

**Order is somebody's arrangement, not a sort.** `Favorite.position` exists
because a bookmark list is a *shortcut bar*: the order is a decision the
reader made, and re-sorting it by name or date would throw that away. New
bookmarks land at the end.

**A recent is not a favourite and is not editable.** `RecentItem` is a
by-product of visiting things; it has a visit count and a last-visited moment,
and the only thing anybody does to it is look at it or clear the lot. Mixing
the two lists would make the deliberate one indistinguishable from the
automatic one.

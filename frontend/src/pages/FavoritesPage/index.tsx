/**
 * `/favorites` — the things you kept, and the things you happened to visit (§38, §39).
 *
 * Six decisions worth the reader's attention.
 *
 * **Two lists, kept apart.** Bookmarks are a decision; recents are a
 * by-product. Merging them would make the list somebody curated
 * indistinguishable from the list that accumulated, and the whole point of a
 * shortcut bar is that everything in it was put there on purpose.
 *
 * **The bookmark list is arranged, not sorted.** No column headers to click:
 * the order *is* the information, and offering "sort by name" would invite
 * somebody to destroy the arrangement they made. Moving one is two buttons,
 * because a keyboard-only reader cannot drag (§65) — and the whole order goes
 * to the server in one call, so two moves cannot fight over one position.
 *
 * **A bookmark opens what it points at, and nothing else.** It carries a
 * stored in-app route, so it keeps working after a rename and after a router
 * change for new records only. There is no "edit": a name typed here would be
 * a second name for the same thing.
 *
 * **Recents offer a star, and that is the only thing they offer.** The row
 * already says whether it is bookmarked, so no request is needed to find out —
 * and starring a recent is how most bookmarks are actually made, which is why
 * it is on the row rather than behind a menu.
 *
 * **Clearing the trail is all-or-nothing, and says so.** Removing one entry
 * from a trail leaves a misleading trail. The confirmation also says the
 * bookmarks survive, because "clear" beside two lists is a frightening word.
 *
 * **Both lists say what would be here.** An empty bookmark list explains how
 * one is made rather than saying "no data" — that is the state a new account
 * is in, and it is the one worth writing for.
 */

import { Button, Skeleton } from "antd";
import { ReloadOutlined } from "@ant-design/icons";

import { PageHeader } from "@/components/PageHeader";
import { formatNumber } from "@/lib/formats";

export { capacityNote, kindLabel, movedOrder } from "./favorites";

import { BookmarksCard } from "./BookmarksCard";
import { RecentsCard } from "./RecentsCard";
import { useFavoritesPage } from "./useFavoritesPage";

export default function FavoritesPage() {
  const m = useFavoritesPage();
  const { bookmarks, refresh, list } = m;

  if (bookmarks.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;

  return (
    <div className="nu-fav nx-fd-fav">
      <PageHeader
        title="Favorites"
        subtitle={
          list
            ? `${formatNumber(list.total)} kept — records, views and dashboards — and what you have looked at lately`
            : "The things you keep, and the things you have looked at lately."
        }
        actions={
          <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
            Refresh
          </Button>
        }
      />

      <BookmarksCard m={m} />

      <RecentsCard m={m} />
    </div>
  );
}

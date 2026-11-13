import { Button, Card } from "antd";

import { EmptyState } from "@/components/EmptyState";

import { Notice } from "../parts/Notice";
import type { AnnouncementsPageData } from "../useAnnouncementsPage";

/** The reader's noticeboard: the category strip, the notices, and the history switch. */
export function ReadView({ page }: { page: AnnouncementsPageData }) {
  const { category, includeExpired, set, feed, mark, items } = page;
  return (
    <>
      {/* The strip: one chip per category over the live set, and the
          filter. Counts are the server's — a chip counting the page it
          returned would say "of the twenty I sent" (§71). */}
      <div className="nu-kindstrip nx-ov-kinds" data-testid="announcement-categories">
        <button
          type="button"
          className={`nu-kindchip${category === "" ? " is-active" : ""}`}
          aria-pressed={category === ""}
          onClick={() => set({ category: null })}
        >
          <span className="nu-kindchip-label">Everything</span>
          <span className="nu-kindchip-count">
            {(feed.data?.categories ?? []).reduce((sum, entry) => sum + entry.count, 0)}
          </span>
        </button>
        {(feed.data?.categories ?? []).map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={`nu-kindchip${category === entry.key ? " is-active" : ""}${
              entry.count === 0 ? " is-empty" : ""
            }`}
            aria-pressed={category === entry.key}
            disabled={entry.count === 0}
            onClick={() => set({ category: entry.key })}
            data-testid={`announcement-category-${entry.key}`}
          >
            <span className="nu-kindchip-label">{entry.label}</span>
            <span className="nu-kindchip-count">{entry.count}</span>
          </button>
        ))}
      </div>

      <div className="nu-announce-board" data-testid="announcement-board">
        {items.length === 0 ? (
          <Card size="small">
            <EmptyState
              title={includeExpired ? "Nothing has been announced" : "Nothing current"}
              hint={
                includeExpired
                  ? "Announcements written here will appear on everybody's noticeboard."
                  : "Notices that have run out are kept — they are just not shown by default."
              }
              action={
                !includeExpired ? (
                  <Button onClick={() => set({ history: "1" })}>Look at what expired</Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          items.map((notice) => (
            <Notice
              key={notice.id}
              notice={notice}
              acknowledging={mark.isPending}
              onAcknowledge={() => mark.mutate({ id: notice.id, acknowledged: true })}
            />
          ))
        )}

        {/* History is one click away rather than on the page: a
            maintenance window that has passed is worth looking up, not
            worth being shown every morning. */}
        <div className="nu-announce-foot">
          <Button
            type="text"
            onClick={() => set({ history: includeExpired ? null : "1" })}
            data-testid="announcement-history"
          >
            {includeExpired ? "Show only what is current" : "Include what has expired"}
          </Button>
        </div>
      </div>
    </>
  );
}

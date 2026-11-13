import { Button, Card, Pagination } from "antd";

import { EmptyState } from "@/components/EmptyState";

import { FeedRow } from "../model";
import type { ActivityPageData } from "../useActivityPage";

/** The feed itself, newest first. */
export function FeedCard({ view }: { view: ActivityPageData }) {
  const { kind, resourceType, actorId, page, set, feed, items, days } = view;
  return (
    <Card size="small" className="nx-ov-feed" data-testid="activity-feed">
      {items.length === 0 ? (
        <EmptyState
          title="Nothing happened here"
          hint={
            kind || resourceType || actorId
              ? "Widen the period, or clear a filter."
              : "Activity is recorded as people work — this period has none."
          }
          action={
            <Button onClick={() => set({ period: "all_time", kind: null })}>
              Look at all time
            </Button>
          }
        />
      ) : (
        <>
          {days.map((day) => (
            <section key={day.label} className="nu-feed-day">
              <h2 className="nu-feed-daylabel">{day.label}</h2>
              <ul className="nu-feed">
                {day.items.map((entry) => (
                  <FeedRow key={entry.id} entry={entry} />
                ))}
              </ul>
            </section>
          ))}

          {(feed.data?.pages ?? 1) > 1 && (
            <div className="nu-queue-pager">
              <Pagination
                simple
                current={feed.data?.page ?? page}
                pageSize={feed.data?.page_size ?? 50}
                total={feed.data?.total ?? 0}
                onChange={(next) => set({ page: next === 1 ? null : String(next) })}
              />
            </div>
          )}
        </>
      )}
    </Card>
  );
}

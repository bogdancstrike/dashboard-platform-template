/**
 * `/activity` — what has been going on (§35, §48).
 *
 * A feed is worth a page only if it can be *narrowed* faster than it can be
 * read. Everything here follows from that.
 *
 * **The strip is the filter.** One chip per kind of thing that happens, each
 * carrying its count, and clicking one narrows the feed. The counts come from
 * the server over the whole matching set, so they mean "of everything in this
 * period" rather than "of the fifty rows I downloaded" (§71) — and they do not
 * move when a chip is chosen, because a strip whose numbers change as you use
 * it cannot be used to compare.
 *
 * **Every kind is offered, including the empty ones.** A chip that vanishes
 * when nothing has happened teaches a reader that the platform has stopped
 * recording that kind. "Comments — 0" is a fact; a missing chip is a mystery.
 *
 * **Grouped by day, not stamped per row.** Forty rows each reading "3d ago" is
 * a wall of text; the same rows under *Today* / *Yesterday* / *Friday* are
 * skimmable, because the eye finds the boundary without reading a row.
 *
 * **This is not the audit trail.** `/api/audit/timeline` answers "what was
 * done to *this record*, exactly", and the ledger behind `audit.view` is
 * evidence — who, from which address, with which values before and after.
 * This answers a different question for a different reader, which is why it is
 * a different endpoint at `records.view`.
 */

import { Alert, Button, Skeleton, Tag, Typography } from "antd";

import { ApiError } from "@/api/client";
import { PageHeader } from "@/components/PageHeader";
import { AutoRefresh } from "@/components/AutoRefresh";

import { FeedCard } from "./parts/FeedCard";
import { FeedFilters } from "./parts/FeedFilters";
import { KindStrip } from "./parts/KindStrip";
import { PeriodContext } from "./parts/PeriodContext";
import { useActivityPage } from "./useActivityPage";

const { Text } = Typography;

export default function ActivityPage() {
  const view = useActivityPage();
  const { feed, matched } = view;
  // `isLoading` is the *first* load only — a refetch keeps the previous page
  // on screen through `placeholderData`, so the feed does not blink every time
  // a filter changes.
  if (feed.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (feed.isError) {
    const error = feed.error;
    return (
      <>
        <PageHeader title="Activity" />
        <Alert
          type={error instanceof ApiError && error.isForbidden ? "warning" : "error"}
          showIcon
          message={error instanceof ApiError ? error.message : "The feed could not be loaded."}
          description={
            error instanceof ApiError ? (
              <Text code copyable={{ text: error.correlationId }}>
                {error.correlationId}
              </Text>
            ) : undefined
          }
          action={<Button onClick={() => void feed.refetch()}>Retry</Button>}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle="Everything that happened, newest first — narrow it by what kind of thing it was."
        tag={<Tag color="blue">{matched.toLocaleString()} in this period</Tag>}
        actions={
          // A feed is the clearest case for the reader's own interval: what is
          // on screen is only as current as the last request, and this page is
          // one people leave open (§53).
          <AutoRefresh
            page="activity"
            updatedAt={feed.dataUpdatedAt}
            busy={feed.isFetching}
            refresh={() => void feed.refetch()}
          />
        }
      />

      <KindStrip view={view} />

      <div className="nx-ov-activity">
        <div className="nx-ov-activity-main">
          <FeedFilters view={view} />

          <FeedCard view={view} />
        </div>

        <PeriodContext view={view} />
      </div>
    </>
  );
}

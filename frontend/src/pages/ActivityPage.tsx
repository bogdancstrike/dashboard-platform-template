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

import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Pagination,
  Select,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { activityApi, type ActivityEntry } from "@/api/activity";
import { ApiError } from "@/api/client";
import { explorerApi } from "@/api/explorer";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { PeoplePicker } from "@/components/PeoplePicker";
import { usePageCommands } from "@/commands/CommandContext";
import { absoluteTime, groupByDay, relativeTime } from "@/lib/time";
import { AutoRefresh } from "@/components/AutoRefresh";

const { Text } = Typography;

/**
 * How long a period the reader can ask for.
 *
 * The same keys the analysis compiler resolves, so "the last 30 days" means
 * one thing across the product rather than one thing per page.
 */
const PERIODS = [
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_90_days", label: "Last 90 days" },
  { value: "all_time", label: "All time" },
];

/**
 * Which kinds are worth a colour in a row, and which are not.
 *
 * Almost none. A tag per kind in AntD's preset palette looked lively and
 * failed contrast — `orange` is `#d46b08` on `#fff7e6`, which is 3.33:1 and
 * under the 4.5 a 10px label needs (§64). Only the semantic four have inks
 * this product has verified, and only one kind earns one: a sign-in or an
 * impersonation is what a reader scans a feed *for*. The rest are a quiet
 * label, because the strip above already carries the vocabulary and eight
 * colours in a column is decoration.
 */
const KIND_COLOUR: Record<string, string | undefined> = {
  SECURITY: "error",
};

export default function ActivityPage() {
  const [params, setParams] = useSearchParams();

  const kind = params.get("kind") ?? "";
  const resourceType = params.get("resource_type") ?? "";
  const actorId = params.get("actor_id") ?? "";
  const period = params.get("period") ?? "last_30_days";
  const page = Number(params.get("page") ?? 1);

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        // Any change to the question starts at the beginning: page 3 of a
        // different question is not a place anybody asked to be.
        if (!("page" in changes)) next.delete("page");
        return next;
      },
      { replace: true },
    );

  const feed = useQuery({
    queryKey: ["activity", kind, resourceType, actorId, period, page],
    queryFn: ({ signal }) =>
      activityApi.feed({ kind, resource_type: resourceType, actor_id: actorId, period, page }, signal),
    placeholderData: (previous) => previous,
  });

  // The datasets a reader may filter by come from the explorer's catalogue,
  // which is generated from the same declarations the feed validates against —
  // so this select cannot offer a value the endpoint would refuse.
  const catalogue = useQuery({
    queryKey: ["explorer-catalogue"],
    queryFn: ({ signal }) => explorerApi.catalogue(signal),
    staleTime: 300_000,
  });

  // Memoised, because the grouping below depends on it: a fresh `[]` on every
  // render would re-bucket the feed on every keystroke elsewhere on the page.
  const items = useMemo(() => feed.data?.items ?? [], [feed.data]);
  const days = useMemo(() => groupByDay(items, (item) => item.occurred_at), [items]);

  usePageCommands("activity", [
    {
      id: "activity.refresh",
      label: "Refresh the activity feed",
      keywords: "reload again",
      run: () => void feed.refetch(),
    },
    {
      id: "activity.security",
      label: "Show sign-ins and security events",
      keywords: "login impersonate",
      run: () => set({ kind: "SECURITY" }),
    },
    {
      id: "activity.clear",
      label: "Clear the activity filters",
      keywords: "reset all",
      run: () => setParams(new URLSearchParams(), { replace: true }),
    },
  ]);

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
          action={
            <Button size="small" onClick={() => void feed.refetch()}>
              Retry
            </Button>
          }
        />
      </>
    );
  }

  const kinds = feed.data?.kinds ?? [];
  const matched = feed.data?.matched ?? 0;

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

      {/* The strip: every kind, its count over the whole match, and the
          filter. A chip at zero is still offered — see the module docstring. */}
      <div className="nu-kindstrip nu-kindstrip--fill" data-testid="activity-kinds">
        <button
          type="button"
          className={`nu-kindchip${kind === "" ? " is-active" : ""}`}
          aria-pressed={kind === ""}
          onClick={() => set({ kind: null })}
        >
          <span className="nu-kindchip-count">{matched.toLocaleString()}</span>
          <span className="nu-kindchip-label">Everything</span>
        </button>
        {kinds.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={`nu-kindchip${kind === entry.key ? " is-active" : ""}${
              entry.count === 0 ? " is-empty" : ""
            }`}
            aria-pressed={kind === entry.key}
            // Offered at zero, and refused: the reader learns the kind exists
            // and that nothing of it happened in this period (§76).
            disabled={entry.count === 0}
            onClick={() => set({ kind: entry.key })}
            data-testid={`activity-kind-${entry.key}`}
          >
            <span className="nu-kindchip-count">{entry.count.toLocaleString()}</span>
            <span className="nu-kindchip-label">{entry.label}</span>
          </button>
        ))}
      </div>

      <Card size="small" className="nu-filter-bar nu-block">
        <Space size={8} wrap>
          <Select
            aria-label="Period"
            style={{ minWidth: 150 }}
            value={period}
            onChange={(next) => set({ period: next })}
            options={PERIODS}
          />
          <Select
            aria-label="Dataset"
            style={{ minWidth: 170 }}
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Any dataset"
            value={resourceType || undefined}
            onChange={(next: string | undefined) => set({ resource_type: next ?? null })}
            options={(catalogue.data?.items ?? []).map((item) => ({
              value: item.key,
              label: item.label,
            }))}
          />
          {/* One person, searched in the directory rather than typed: an
              actor filter that takes a UUID is a filter for whoever wrote it. */}
          <div style={{ minWidth: 240 }}>
            <PeoplePicker
              multiple={false}
              aria-label="Actor"
              data-testid="activity-actor"
              placeholder="Anybody"
              value={actorId ? [actorId] : []}
              onChange={(ids) => set({ actor_id: ids[0] ?? null })}
            />
          </div>
          {(kind || resourceType || actorId || period !== "last_30_days") && (
            <Button type="text" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              Clear
            </Button>
          )}
        </Space>
      </Card>

      <Card size="small" data-testid="activity-feed">
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
    </>
  );
}

/**
 * One thing that happened.
 *
 * The sentence is the server's, printed whole. That is not laziness — it is
 * the only way it cannot be wrong. `core/audit` composes a summary from the
 * action, the dataset and the subject *unless* the code that recorded the
 * event passed a sentence of its own ("updated the Viewer role"), and a client
 * that appended the subject to that produced "updated the Viewer role Viewer".
 * Splicing an actor and a subject back out of a sentence in order to
 * re-assemble it is a second grammar, and it was wrong on the first page it
 * drew.
 *
 * So the row is a *link* instead: the whole thing opens what it is about,
 * which is bigger to click than a word inside a line and cannot contradict
 * the sentence beside it.
 */
function FeedRow({ entry }: { entry: ActivityEntry }) {
  const body = (
    <>
      <Tooltip title={entry.actor.name ?? "The platform"}>
        <Avatar size={26} className="nu-feed-avatar">
          {entry.actor.initials ?? "·"}
        </Avatar>
      </Tooltip>

      <div className="nu-feed-body">
        <div className="nu-feed-line">
          <Text strong>{entry.actor.name ?? "The platform"}</Text>{" "}
          <Text type="secondary">{entry.summary ?? actionWords(entry.action)}</Text>
        </div>

        {/* What it was on the left, when it happened on the right. Both used
            to sit at the left edge, which left the other half of every row
            blank on a wide page — and the time is what a reader scans a feed
            *by*. */}
        <div className="nu-feed-meta">
          <span className="nu-feed-meta-kind">
            <Tag color={KIND_COLOUR[entry.kind]} bordered={false}>
              {entry.kind_label}
            </Tag>
            {entry.changed.length > 0 && (
              <Tooltip title={entry.changed.join(", ")}>
                <Text type="secondary">
                  {entry.changed.length} field{entry.changed.length === 1 ? "" : "s"} changed
                </Text>
              </Tooltip>
            )}
          </span>
          <Tooltip title={absoluteTime(entry.occurred_at)}>
            <Text type="secondary">{relativeTime(entry.occurred_at)}</Text>
          </Tooltip>
        </div>
      </div>
    </>
  );

  if (!entry.resource_path) {
    return <li className="nu-feed-row">{body}</li>;
  }

  return (
    <li>
      <Link
        className="nu-feed-row nu-feed-row--link"
        to={entry.resource_path}
        aria-label={`${entry.actor.name ?? "The platform"} ${entry.summary ?? entry.action}`}
      >
        {body}
      </Link>
    </li>
  );
}

/**
 * The action as words, for the one case the server has no sentence for.
 *
 * A fallback, not a vocabulary: `summary` is written for every entry the
 * platform records, and one without it is old data or a bug. Showing
 * `STATUS_CHANGE` raw would be worse than showing "status change".
 */
function actionWords(action: string): string {
  return action.replace(/_/g, " ").toLowerCase();
}

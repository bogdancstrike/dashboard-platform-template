/** The activity feed's vocabulary and helpers: periods, kind colours, the period summary, and a row of the feed. */

import { Avatar, Tag, Tooltip, Typography } from "antd";
import { Link } from "react-router-dom";

import type { ActivityEntry } from "@/api/activity";
import { absoluteTime, relativeTime } from "@/lib/time";

const { Text } = Typography;

/**
 * How long a period the reader can ask for.
 *
 * The same keys the analysis compiler resolves, so "the last 30 days" means
 * one thing across the product rather than one thing per page.
 */
export const PERIODS = [
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
export const KIND_COLOUR: Record<string, string | undefined> = {
  SECURITY: "error",
};

/** What the side panels draw, from a sample of the feed. Pure, for its test. */
export function summarise(items: ActivityEntry[]) {
  const byDay = new Map<string, { key: string; label: string; count: number }>();
  const byPerson = new Map<
    string,
    { id: string | null; name: string | null; initials: string | null; count: number }
  >();
  const byRecord = new Map<string, { path: string; label: string; type: string; count: number }>();
  for (const item of items) {
    const when = new Date(item.occurred_at);
    const key = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`;
    const day = byDay.get(key) ?? {
      key,
      label: when.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
      count: 0,
    };
    day.count += 1;
    byDay.set(key, day);

    const who = item.actor.id ?? "platform";
    const person = byPerson.get(who) ?? { ...item.actor, count: 0 };
    person.count += 1;
    byPerson.set(who, person);

    if (item.resource_path) {
      const record = byRecord.get(item.resource_path) ?? {
        path: item.resource_path,
        label: item.resource_label ?? item.resource_path,
        type: (item.resource_type ?? "").replace(/_/g, " "),
        count: 0,
      };
      record.count += 1;
      byRecord.set(item.resource_path, record);
    }
  }
  const days = [...byDay.values()].sort((a, b) => a.key.localeCompare(b.key)).slice(-21);
  return {
    days,
    busiest: Math.max(1, ...days.map((day) => day.count)),
    people: [...byPerson.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    records: [...byRecord.values()].sort((a, b) => b.count - a.count).slice(0, 5),
  };
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
export function FeedRow({ entry }: { entry: ActivityEntry }) {
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
export function actionWords(action: string): string {
  return action.replace(/_/g, " ").toLowerCase();
}

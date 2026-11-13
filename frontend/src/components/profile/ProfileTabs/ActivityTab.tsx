import type { ReactNode } from "react";
import { Card, Segmented, Skeleton, Tooltip, } from "antd";
import { Link } from "react-router-dom";

import type { ActivityEntry, ActivityFeed } from "@/api/activity";
import type { Profile } from "@/api/profile";
import { EmptyState } from "@/components/EmptyState";
import { formatNumber } from "@/lib/formats";

import { dayHeading, dayKey, perDay } from "./activityDays";



export function ProfileActivityTab({
  profile,
  feed,
  loading,
  kind,
  onKind,
  heatmap,
}: {
  profile: Profile;
  feed: ActivityFeed | undefined;
  loading: boolean;
  kind: string;
  onKind: (kind: string) => void;
  /** "When they work", already built by the page. */
  heatmap: ReactNode;
}) {
  if (!profile.visibility.activity) {
    return (
      <EmptyState
        title="Their activity is not shown"
        hint="A list of everything one person did is the audit log, so it needs the audit.view permission."
      />
    );
  }
  if (loading && !feed) return <Skeleton active paragraph={{ rows: 6 }} />;

  const items = feed?.items ?? [];
  const days = perDay(items);
  const max = Math.max(1, ...days.map((day) => day.n));
  const grouped = new Map<string, ActivityEntry[]>();
  for (const item of items) {
    const key = dayKey(item.occurred_at);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  const kinds = feed?.kinds ?? [];
  const total = kinds.reduce((sum, entry) => sum + entry.count, 0);

  return (
    <div className="nx-fd-pactivity" data-testid="profile-activity">
      <Card size="small" className="nx-fd-pcard" title="The last two weeks">
        <div className="nx-fd-pdays" role="img" aria-label="Actions per day over the last 14 days">
          {days.map((day) => (
            <Tooltip key={day.key} title={`${day.label}: ${day.n}`}>
              <span className="nx-fd-pday">
                <span className="nx-fd-pbar" style={{ height: `${Math.max(4, Math.round((day.n / max) * 100))}%` }} data-empty={day.n === 0} />
              </span>
            </Tooltip>
          ))}
        </div>
        {kinds.length > 0 && (
          <Segmented
            className="nx-fd-kinds"
            aria-label="Kind of activity"
            value={kind || "all"}
            onChange={(next) => onKind(next === "all" ? "" : String(next))}
            options={[
              { value: "all", label: `All (${formatNumber(total)})` },
              ...kinds.map((entry) => ({ value: entry.key, label: `${entry.label} (${formatNumber(entry.count)})` })),
            ]}
          />
        )}
      </Card>

      {items.length === 0 ? (
        <EmptyState title="Nothing recorded yet" hint="Their actions will appear here." />
      ) : (
        <Card size="small" className="nx-fd-pcard nx-fd-ptrail">
          {[...grouped.entries()].map(([key, entries]) => (
            <section key={key} className="nx-fd-pdaygroup" aria-label={dayHeading(key)}>
              <h3 className="nx-fd-eyebrow">{dayHeading(key)} · {entries.length}</h3>
              <ul className="nx-fd-plist">
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <span className="nx-fd-ptime">
                      {new Date(entry.occurred_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    </span>
                    <span className="nx-fd-pill">{entry.kind_label}</span>
                    <span className="nx-fd-grow nx-fd-ptext">
                      {entry.summary || entry.action}
                      {entry.resource_label && entry.resource_path && (
                        <>
                          {" · "}
                          <Link to={entry.resource_path}>{entry.resource_label}</Link>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </Card>
      )}

      {heatmap}
    </div>
  );
}

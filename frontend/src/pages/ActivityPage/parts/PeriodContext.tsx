import { Avatar, Card, Skeleton, Tooltip, Typography } from "antd";
import { Link } from "react-router-dom";

const { Text } = Typography;

import type { ActivityPageData } from "../useActivityPage";

/** What the period looks like: per day, by kind, by person. */
export function PeriodContext({ view }: { view: ActivityPageData }) {
  const { kind, actorId, set, context, summary, kinds, matched } = view;
  return (
    <aside
      className="nx-ov-activity-side"
      aria-label="What the period looks like"
      data-testid="activity-context"
    >
      <Card size="small" title="Per day" className="nx-ov-panel">
        {context.isLoading ? (
          <Skeleton active paragraph={{ rows: 2 }} title={false} />
        ) : summary.days.length === 0 ? (
          <Text type="secondary">Nothing in this period</Text>
        ) : (
          <div
            className="nx-ov-daybars"
            role="img"
            aria-label={`Entries per day: ${summary.days.map((day) => `${day.label} ${day.count}`).join(", ")}`}
          >
            {summary.days.map((day) => (
              <Tooltip key={day.key} title={`${day.label}: ${day.count}`}>
                <span className="nx-ov-daybar">
                  <i style={{ height: `${Math.max(6, (day.count / summary.busiest) * 100)}%` }} />
                </span>
              </Tooltip>
            ))}
          </div>
        )}
        {summary.days.length > 0 && (
          <div className="nx-ov-daybars-axis">
            <span>{summary.days[0]?.label}</span>
            <span>{summary.days.at(-1)?.label}</span>
          </div>
        )}
      </Card>

      <Card size="small" title="By kind" className="nx-ov-panel">
        <div className="nx-ov-meters">
          {kinds
            .filter((entry) => entry.count > 0)
            .map((entry) => (
              <button
                key={entry.key}
                type="button"
                className={`nx-ov-meter${kind === entry.key ? " is-on" : ""}`}
                aria-pressed={kind === entry.key}
                onClick={() => set({ kind: kind === entry.key ? null : entry.key })}
              >
                <span className="nx-ov-meter-label">{entry.label}</span>
                <span className="nx-ov-meter-count">{entry.count.toLocaleString()}</span>
                <span className="nx-ov-meter-track">
                  <i style={{ width: `${(entry.count / Math.max(1, matched)) * 100}%` }} />
                </span>
              </button>
            ))}
        </div>
      </Card>

      <Card size="small" title="Most active" className="nx-ov-panel">
        {summary.people.length === 0 ? (
          <Text type="secondary">Nobody yet</Text>
        ) : (
          <div className="nx-ov-rows nx-ov-rows--plain">
            {summary.people.map((person) => (
              <button
                key={person.id ?? "platform"}
                type="button"
                className={`nx-ov-person${actorId && actorId === person.id ? " is-on" : ""}`}
                disabled={!person.id}
                onClick={() => set({ actor_id: actorId === person.id ? null : person.id })}
              >
                <Avatar size={28} className="nu-feed-avatar">
                  {person.initials ?? "·"}
                </Avatar>
                <span className="nx-ov-person-name">{person.name ?? "The platform"}</span>
                <span className="nx-ov-count">{person.count}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card size="small" title="Most touched" className="nx-ov-panel">
        {summary.records.length === 0 ? (
          <Text type="secondary">No records changed</Text>
        ) : (
          <div className="nx-ov-rows nx-ov-rows--plain">
            {summary.records.map((record) => (
              <Link key={record.path} to={record.path} className="nx-ov-touched">
                <span className="nx-ov-touched-label">{record.label}</span>
                <span className="nx-ov-touched-type">{record.type}</span>
                <span className="nx-ov-count">{record.count}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>
      {(context.data?.matched ?? 0) > (context.data?.items.length ?? 0) && (
        <Text type="secondary" className="nx-ov-sample-note">
          From the newest {context.data?.items.length} of {context.data?.matched.toLocaleString()}{" "}
          entries.
        </Text>
      )}
    </aside>
  );
}

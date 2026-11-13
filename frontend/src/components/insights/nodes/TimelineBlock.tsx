import { Timeline, Typography } from "antd";
import { Link } from "react-router-dom";

import type { TimelineNode } from "../spec";

const { Text } = Typography;

export function TimelineBlock({ node }: { node: TimelineNode }) {
  if (!node.events.length) return <Text type="secondary">Nothing happened in this window.</Text>;
  const colors = { info: "blue", success: "green", warning: "orange", danger: "red" } as const;
  return (
    <Timeline
      className="nx-in-timeline"
      items={node.events.map((event) => ({
        color: event.tone ? colors[event.tone] : "blue",
        children: (
          <div>
            <Text type="secondary" className="nx-in-timeline-date">
              {event.date}
            </Text>
            <div>{event.href ? <Link to={event.href}>{event.title}</Link> : event.title}</div>
            {event.text && <Text type="secondary">{event.text.replace(/_/g, " ")}</Text>}
          </div>
        ),
      }))}
    />
  );
}

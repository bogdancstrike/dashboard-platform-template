import { Timeline } from "antd";

export default function TimelineAntd() {
  return (
    <Timeline
      items={[
        { color: "green", children: "Raised · via portal · 09:12" },
        { color: "blue", children: "First answered after 17 min" },
        { color: "red", children: "Promised by 12:00 — missed, and still open" },
        { color: "gray", children: "Resolved · still open" },
      ]}
    />
  );
}

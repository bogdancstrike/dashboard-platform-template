import { Card, Segmented } from "antd";

import { PageHeader } from "@/components/PageHeader";
import { PersonAvatar } from "@/components/PersonAvatar";

const DAYS = [
  { day: "Today", rows: [{ who: "Ada Administrator", initials: "AA", what: "moved PLAT-00002 to Backlog", when: "11m ago" }, { who: "Mara Manager", initials: "MM", what: "commented on TIC-00041", when: "1h ago" }] },
  { day: "Yesterday", rows: [{ who: "Otto Operator", initials: "OO", what: "closed ORD-20811 as a duplicate", when: "18:02" }] },
];

export default function FeedTemplate() {
  return (
    <div className="nx-ad">
      <PageHeader title="Activity" subtitle="What changed, across everything you can see" actions={<Segmented aria-label="Whose" options={["Everyone", "Mine"]} />} />
      {DAYS.map((group) => (
        <Card key={group.day} title={group.day}>
          <div className="nx-doc-feed">
            <ul>
              {group.rows.map((row) => (
                <li key={row.what}>
                  <PersonAvatar initials={row.initials} size="small" />
                  <span><b>{row.who}</b> {row.what}</span>
                  <time>{row.when}</time>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      ))}
    </div>
  );
}

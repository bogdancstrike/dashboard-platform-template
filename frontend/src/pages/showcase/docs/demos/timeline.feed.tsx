import { PersonAvatar } from "@/components/PersonAvatar";

const FEED = [
  { who: "Ada Administrator", initials: "AA", what: "moved PLAT-00002 to Backlog", when: "11m ago" },
  { who: "Mara Manager", initials: "MM", what: "commented on TIC-00041", when: "1h ago" },
  { who: "Otto Operator", initials: "OO", what: "closed ORD-20811 as a duplicate", when: "Yesterday" },
];

export default function TimelineFeed() {
  return (
    <div className="nx-doc-feed">
      <h4>Today</h4>
      <ul>
        {FEED.map((row) => (
          <li key={row.what}>
            <PersonAvatar initials={row.initials} size="small" />
            <span>
              <b>{row.who}</b> {row.what}
            </span>
            <time>{row.when}</time>
          </li>
        ))}
      </ul>
    </div>
  );
}

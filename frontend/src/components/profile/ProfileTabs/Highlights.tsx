import { Card, } from "antd";

import type { Profile } from "@/api/profile";
import { EmptyState } from "@/components/EmptyState";
import { relativeTime } from "@/lib/time";


/** The last few things they did, from the profile payload itself. */
export function Highlights({ profile }: { profile: Profile }) {
  const items = (profile.recent_activity ?? []).slice(0, 6);
  return (
    <Card size="small" title="Recently" className="nx-fd-pcard" data-testid="profile-highlights">
      {!profile.visibility.activity ? (
        <EmptyState compact title="Their recent activity is not shown" />
      ) : items.length === 0 ? (
        <EmptyState compact title="Nothing recorded yet" />
      ) : (
        <ul className="nx-fd-plist">
          {items.map((item) => (
            <li key={item.id}>
              <span className="nx-fd-pdot" aria-hidden="true" />
              <span className="nx-fd-grow">
                <span className="nx-fd-ptext">{item.summary || `${item.action} ${item.resource_label ?? ""}`}</span>
                <span className="nx-fd-muted nx-fd-tiny">{relativeTime(item.occurred_at)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

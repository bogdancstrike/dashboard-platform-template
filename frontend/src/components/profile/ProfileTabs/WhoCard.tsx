import type { ReactNode } from "react";
import { Card, } from "antd";
import { Link } from "react-router-dom";
import { formatNumber } from "@/lib/formats";

import type { Profile } from "@/api/profile";


/** Where they sit and how they are set up — the facts the header leaves out. */
export function WhoCard({ profile }: { profile: Profile }) {
  const facts: Array<[string, ReactNode]> = [
    ["Organization", profile.organization?.name ?? "—"],
    ["Department", profile.department?.name ?? "—"],
    ["Team", profile.team?.name ?? "—"],
    [
      "Reports to",
      profile.manager ? <Link to={`/profile/${profile.manager.id}`}>{profile.manager.name}</Link> : "—",
    ],
    ["Sign-ins", profile.login_count === null ? "—" : formatNumber(profile.login_count)],
    ["Two-step verification", profile.mfa_enabled ? "On" : "Off"],
  ];
  return (
    <Card size="small" title="Where they sit" className="nx-fd-pcard" data-testid="profile-who">
      <dl className="nx-fd-facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {profile.groups.length > 0 && (
        <div className="nx-fd-pgroups">
          <span className="nx-fd-eyebrow">Groups</span>
          <div className="nx-fd-chipline">
            {profile.groups.map((group) => (
              <span className="nx-fd-pill" key={group.id}>{group.name}</span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

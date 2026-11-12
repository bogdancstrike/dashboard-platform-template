import { Link } from "react-router-dom";

import { NxIcon, type NxIconName } from "@/components/NxIcon";
import { PageHeader } from "@/components/PageHeader";

const AREAS: { to: string; title: string; what: string; icon: NxIconName }[] = [
  { to: "/admin/users", title: "People", what: "Who has an account, and what they hold.", icon: "user" },
  { to: "/admin/roles", title: "Roles & permissions", what: "Every permission the code checks for.", icon: "shield" },
  { to: "/admin/audit", title: "Audit log", what: "Who did what, and what changed.", icon: "audit" },
  { to: "/admin/health", title: "System health", what: "Whether each dependency is answering.", icon: "heart" },
];

export default function AreaIndexTemplate() {
  return (
    <div className="nx-ad">
      <PageHeader title="Administration" subtitle="Only the areas you may open are listed" />
      <nav className="nx-ad-map" aria-label="Areas">
        {AREAS.map((area) => (
          <Link key={area.to} to={area.to} className="nx-ad-mapcard">
            <span className="nx-ad-icon" aria-hidden="true"><NxIcon name={area.icon} /></span>
            <span className="nx-ad-mapcard-text">
              <span className="nx-ad-mapcard-head"><b>{area.title}</b></span>
              <span className="nx-ad-mapcard-what">{area.what}</span>
            </span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

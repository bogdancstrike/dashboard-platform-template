import { Link } from "react-router-dom";

import { NxIcon } from "@/components/NxIcon";

const AREAS = [
  { to: "/admin/users", title: "People", what: "Who has an account, and what they hold.", icon: "user" as const, badge: "150 people" },
  { to: "/admin/roles", title: "Roles & permissions", what: "Every permission the code checks for.", icon: "shield" as const },
  { to: "/admin/health", title: "System health", what: "Whether each dependency is answering.", icon: "heart" as const },
];

export default function AdminMapCard() {
  return (
    <nav className="nx-ad-map" aria-label="Example areas">
      {AREAS.map((area) => (
        <Link key={area.to} to={area.to} className="nx-ad-mapcard">
          <span className="nx-ad-icon" aria-hidden="true">
            <NxIcon name={area.icon} />
          </span>
          <span className="nx-ad-mapcard-text">
            <span className="nx-ad-mapcard-head">
              <b>{area.title}</b>
              {area.badge && <span className="nx-ad-badge">{area.badge}</span>}
            </span>
            <span className="nx-ad-mapcard-what">{area.what}</span>
          </span>
        </Link>
      ))}
    </nav>
  );
}

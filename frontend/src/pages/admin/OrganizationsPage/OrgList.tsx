import { Card, Skeleton, Tag } from "antd";

import type { Organization } from "@/api/organizations";

interface OrgListProps {
  organizations: Organization[];
  loading: boolean;
  opened: string | null;
  onChoose: (id: string) => void;
}

/** The tenants, the chosen one pressed. */
export function OrgList({ organizations, loading, opened, onChoose }: OrgListProps) {
  return (
    <Card size="small" title="Tenants" className="nu-orglist" data-testid="org-list">
      {loading && <Skeleton active paragraph={{ rows: 4 }} />}
      <ul>
        {organizations.map((org) => (
          <li key={org.id}>
            <button
              type="button"
              className={org.id === opened ? "is-active" : undefined}
              aria-pressed={org.id === opened}
              onClick={() => onChoose(org.id)}
              data-testid={`org-${org.slug}`}
            >
              <span className="nu-orglist-name">{org.name}</span>
              <span className="nu-orglist-meta">
                <Tag bordered={false}>{org.tier.toLowerCase()}</Tag>
                {/* Counted, not claimed — see `api/organizations.ts`. */}
                {org.people} {org.people === 1 ? "account" : "accounts"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

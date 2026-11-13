import { Card, Descriptions, Statistic } from "antd";

import type { OrgTree } from "@/api/organizations";
import { formatNumber } from "@/lib/formats";

/** The tenant's own figures and facts, above its tree. */
export function OrgSummary({ org }: { org: OrgTree["organization"] }) {
  return (
    <Card size="small" data-testid="org-summary">
      <div className="nu-orgstats">
        {/* The two numbers, side by side and labelled, because they are
            different facts: a tenant of 4,000 staff with 30 accounts is
            normal and neither figure is wrong. */}
        <Statistic
          title="Accounts here"
          value={org.people}
          formatter={(value) => formatNumber(Number(value))}
        />
        <Statistic
          title="Employees on record"
          value={org.employee_count}
          formatter={(value) => formatNumber(Number(value))}
        />
        <Statistic title="Departments" value={org.department_count} />
        <Statistic title="Teams" value={org.team_count} />
        {/* Absent for a reader without `orgs.manage` — the server withholds
            it rather than sending nought, so this is "not shown to you"
            and not "nothing". Drawn only when it is there. */}
        {org.annual_revenue !== undefined && (
          <Statistic
            title="Annual revenue"
            value={org.annual_revenue}
            formatter={(value) => formatNumber(Number(value))}
          />
        )}
      </div>
      <Descriptions
        size="small"
        column={2}
        className="nu-block"
        items={[
          { key: "tier", label: "Tier", children: org.tier.toLowerCase() },
          { key: "status", label: "Status", children: org.status.toLowerCase() },
          { key: "industry", label: "Industry", children: org.industry ?? "—" },
          {
            key: "where",
            label: "Where",
            children: [org.city, org.country].filter(Boolean).join(", ") || "—",
          },
        ]}
      />
    </Card>
  );
}

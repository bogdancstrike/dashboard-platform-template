import { AlertOutlined, TeamOutlined } from "@ant-design/icons";

import { StatCard } from "@/components/StatCard";

export default function StatCardStates() {
  return (
    <div className="nx-doc-grid">
      <StatCard label="Active users" value={150} icon={<TeamOutlined />} trend="flat" polarity="neutral" changePercent={0} previous={150} />
      <StatCard
        label="Open SLA breaches"
        value={3}
        accent="danger"
        icon={<AlertOutlined />}
        hint="Opens the tickets behind the number"
        onClick={() => undefined}
      />
      <StatCard label="Exports this week" value={9} hint="No comparison — nothing to compare with yet." />
    </div>
  );
}

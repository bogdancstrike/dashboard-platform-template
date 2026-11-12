import { DollarOutlined, FieldTimeOutlined } from "@ant-design/icons";

import { StatCard } from "@/components/StatCard";

export default function StatCardPolarity() {
  return (
    <div className="nx-doc-grid">
      <StatCard
        label="Revenue this month"
        value={482_300}
        unit="EUR"
        icon={<DollarOutlined />}
        trend="up"
        polarity="up_is_good"
        changePercent={12.4}
        previous={429_100}
        hint="Up is good: the same arrow reads as good news here."
      />
      <StatCard
        label="Median response time"
        value={41}
        displayValue="41 min"
        icon={<FieldTimeOutlined />}
        trend="up"
        polarity="down_is_good"
        changePercent={18}
        previous={35}
        hint="Up is bad: a rise reads as bad news here."
      />
    </div>
  );
}

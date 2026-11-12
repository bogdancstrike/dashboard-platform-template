import { Card, Col, Row, Segmented } from "antd";
import { DollarOutlined, FieldTimeOutlined, TeamOutlined } from "@ant-design/icons";

import { ChartCard } from "@/components/ChartCard";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";

export default function DashboardTemplate() {
  return (
    <div className="nx-ad">
      <PageHeader
        title={<>Sales <em>overview</em></>}
        subtitle="Compared with the previous period of equal length"
        actions={<Segmented aria-label="Period" options={["7 days", "30 days", "Quarter"]} />}
      />
      <div className="nx-doc-grid">
        <StatCard label="Revenue" value={482300} unit="EUR" icon={<DollarOutlined />} trend="up" polarity="up_is_good" changePercent={12} previous={429100} />
        <StatCard label="New customers" value={38} icon={<TeamOutlined />} trend="down" polarity="up_is_good" changePercent={4} previous={40} />
        <StatCard label="Time to first reply" value={41} displayValue="41 min" icon={<FieldTimeOutlined />} trend="down" polarity="down_is_good" changePercent={9} previous={45} />
      </div>
      <Row gutter={[14, 14]}>
        <Col xs={24} lg={14}>
          <ChartCard
            id="tmpl-revenue"
            height={200}
            panel={{ kind: "bar", title: "Revenue by month", series: [{ name: "Jul", value: 310 }, { name: "Aug", value: 352 }, { name: "Sep", value: 401 }, { name: "Oct", value: 429 }, { name: "Nov", value: 482 }] }}
          />
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Needs attention">Three renewals this week have no owner.</Card>
        </Col>
      </Row>
    </div>
  );
}

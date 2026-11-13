import { Space, Table, Typography } from "antd";

import type { InsightMetric } from "@/api/explorer";

const { Text } = Typography;

/** The ledger's foot: revenue across the filtered set, as the server counted it. */
export function LedgerTotal({ insights }: { insights: { metrics: InsightMetric[] } }) {
  return (
    <Table.Summary fixed="bottom">
      <Table.Summary.Row className="nu-ledger-total">
        <Table.Summary.Cell index={0} colSpan={7}>
          <Space size={6}>
            <Text strong>Total across the filtered set</Text>
            <Text type="secondary">
              — the server's, not this page's
            </Text>
          </Space>
        </Table.Summary.Cell>
        <Table.Summary.Cell index={7} align="right">
          <Text strong className="nu-money">
            €
            {Math.round(
              insights.metrics.find((metric) => metric.key === "revenue")?.value ?? 0,
            ).toLocaleString()}
          </Text>
        </Table.Summary.Cell>
      </Table.Summary.Row>
    </Table.Summary>
  );
}

import { Card, Space, Tag, Typography } from "antd";
import { AlertOutlined } from "@ant-design/icons";

import { withOrigin } from "@/entities/drilldown";

import { SEVERITY } from "../model";
const { Text } = Typography;

import type { DashboardPageData } from "../useDashboardPage";

/** Only what is actually wrong, each one clickable (§66). */
export function AlertStrip({ page }: { page: DashboardPageData }) {
  const { navigate, here, data } = page;
  return (
    <>
      {/* ── alerts (§66): only what is actually wrong, each one clickable ── */}
      {data && data.alerts.length > 0 && (
        <Card
          size="small"
          className="nu-alert-strip"
          data-testid="dashboard-alerts"
          style={{ marginBottom: 16 }}
        >
          <Space size={6} wrap>
            <AlertOutlined style={{ color: "var(--nu-warning-ink)" }} />
            <Text strong style={{ marginRight: 4 }}>
              Needs attention
            </Text>
            {data.alerts.map((alert) => (
              <Tag
                key={alert.key}
                color={SEVERITY[alert.severity]}
                className="nu-alert-tag"
                onClick={() => navigate(withOrigin(alert.link, here()))}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    navigate(withOrigin(alert.link, here()));
                  }
                }}
              >
                {alert.message}
              </Tag>
            ))}
          </Space>
        </Card>
      )}
    </>
  );
}

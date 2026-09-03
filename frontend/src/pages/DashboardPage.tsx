import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Card, Col, Row, Segmented, Skeleton, Space, Tag, Timeline, Typography } from "antd";
import {
  AlertOutlined,
  ApiOutlined,
  CheckSquareOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  DeploymentUnitOutlined,
  DollarOutlined,
  ExclamationCircleOutlined,
  FolderOutlined,
  FundOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
  UserOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useNavigate, useSearchParams } from "react-router-dom";

import { CHART_KEYS, dashboardApi, type ChartPanel, type DashboardAlert } from "@/api/dashboard";
import { ChartCard } from "@/components/ChartCard";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { SEMANTIC } from "@/theme/tokens";

const { Text } = Typography;

/** Backend icon name → the glyph that stands for it. */
const ICONS: Record<string, React.ReactNode> = {
  euro: <DollarOutlined />,
  "shopping-cart": <ShoppingCartOutlined />,
  users: <TeamOutlined />,
  user: <UserOutlined />,
  "life-buoy": <ApiOutlined />,
  "alert-triangle": <WarningOutlined />,
  "check-square": <CheckSquareOutlined />,
  clock: <ClockCircleOutlined />,
  folder: <FolderOutlined />,
  activity: <FundOutlined />,
  cpu: <DeploymentUnitOutlined />,
  "x-circle": <CloseCircleOutlined />,
  shield: <ExclamationCircleOutlined />,
};

const SEVERITY: Record<DashboardAlert["severity"], { color: string; type: "error" | "warning" | "info" }> = {
  CRITICAL: { color: SEMANTIC.danger, type: "error" },
  WARNING: { color: SEMANTIC.warning, type: "warning" },
  INFO: { color: SEMANTIC.info, type: "info" },
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // The period lives in the URL, so a dashboard somebody is looking at can be
  // sent to a colleague and arrive showing the same thing (§69).
  const period = params.get("period") ?? "last_30_days";

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard", period],
    queryFn: ({ signal }) => dashboardApi.summary({ period }, signal),
  });

  const panels = useMemo(() => {
    if (!data) return [];
    return CHART_KEYS.map((key) => ({ key, panel: data.charts[key] as ChartPanel | undefined })).filter(
      (entry) => entry.panel,
    );
  }, [data]);

  const periodOptions = data?.period.options.filter((option) => option.key !== "custom") ?? [];

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={
          data
            ? `${new Date(data.period.from).toLocaleDateString()} — ${new Date(
                data.period.to,
              ).toLocaleDateString()} · compared with the previous period of equal length`
            : "Loading the overview…"
        }
        actions={
          periodOptions.length > 0 && (
            <Segmented
              size="middle"
              value={period}
              onChange={(next) => {
                const updated = new URLSearchParams(params);
                updated.set("period", String(next));
                setParams(updated, { replace: true });
              }}
              options={periodOptions.map((option) => ({ label: option.label, value: option.key }))}
            />
          )
        }
      />

      {isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="The dashboard could not be loaded"
          description={error instanceof Error ? error.message : "Unknown error"}
        />
      )}

      {/* ── alerts (§66): only what is actually wrong, each one clickable ── */}
      {data && data.alerts.length > 0 && (
        <Card size="small" className="nu-alert-strip" style={{ marginBottom: 16 }}>
          <Space size={6} wrap>
            <AlertOutlined style={{ color: SEMANTIC.warning }} />
            <Text strong style={{ marginRight: 4 }}>
              Needs attention
            </Text>
            {data.alerts.map((alert) => (
              <Tag
                key={alert.key}
                color={SEVERITY[alert.severity].color}
                className="nu-alert-tag"
                onClick={() => navigate(alert.link)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    navigate(alert.link);
                  }
                }}
              >
                {alert.message}
              </Tag>
            ))}
          </Space>
        </Card>
      )}

      {/* ── KPI row (§2) ────────────────────────────────────────────────── */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {isLoading
          ? Array.from({ length: 8 }).map((_, index) => (
              <Col key={index} xs={12} sm={12} md={8} lg={6} xxl={4}>
                <Card className="nu-statcard">
                  <Skeleton active paragraph={{ rows: 1 }} />
                </Card>
              </Col>
            ))
          : data?.kpis.map((kpi) => (
              <Col key={kpi.key} xs={12} sm={12} md={8} lg={6} xxl={4}>
                <StatCard
                  label={kpi.label}
                  value={kpi.value}
                  unit={kpi.unit}
                  icon={ICONS[kpi.icon] ?? <FundOutlined />}
                  accent={kpi.accent}
                  hint={kpi.hint}
                  trend={kpi.trend}
                  polarity={kpi.polarity}
                  changePercent={kpi.change_percent}
                  previous={kpi.previous}
                  onClick={() => navigate(kpi.link)}
                />
              </Col>
            ))}
      </Row>

      {/* ── charts (§2, §44) ────────────────────────────────────────────── */}
      <Row gutter={[12, 12]}>
        {panels.map(({ key, panel }, index) => (
          <Col key={key} xs={24} lg={index < 2 ? 12 : 8}>
            <ChartCard id={key} panel={panel} loading={isLoading} height={index < 2 ? 280 : 240} />
          </Col>
        ))}

        <Col xs={24} lg={8}>
          <Card size="small" title="Recent activity" className="nu-activity-card">
            {isLoading ? (
              <Skeleton active paragraph={{ rows: 6 }} />
            ) : (
              <Timeline
                items={(data?.activity ?? []).map((entry) => ({
                  color: "gray",
                  children: (
                    <div className="nu-activity-item">
                      <Text strong>{entry.actor}</Text> <Text type="secondary">{entry.summary}</Text>
                      <div className="nu-activity-time">
                        {new Date(entry.occurred_at).toLocaleString()}
                      </div>
                    </div>
                  ),
                }))}
              />
            )}
          </Card>
        </Col>
      </Row>
    </>
  );
}

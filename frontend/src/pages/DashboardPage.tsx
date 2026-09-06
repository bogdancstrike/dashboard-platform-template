import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Col, Grid, Row, Segmented, Select, Skeleton, Space, Tag, Timeline, Typography } from "antd";
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

import {
  CHART_KEYS,
  dashboardApi,
  type ChartKind,
  type ChartPanel,
  type DashboardAlert,
} from "@/api/dashboard";
import { ChartCard } from "@/components/ChartCard";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { SEMANTIC } from "@/theme/tokens";
import { ApiError } from "@/api/client";

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

/**
 * How much room each chart kind needs.
 *
 * A twenty-four-column heatmap squeezed into a third of the width is a smear;
 * a gauge given two thirds is mostly whitespace. Sizing by kind rather than by
 * position also means adding a panel does not reshuffle the ones after it.
 */
const SHAPES: Partial<Record<ChartKind, { span: number; height: number }>> = {
  area: { span: 16, height: 280 },
  "stacked-bar": { span: 8, height: 280 },
  funnel: { span: 8, height: 260 },
  hbar: { span: 16, height: 260 },
  "multi-line": { span: 16, height: 260 },
  gauge: { span: 8, height: 260 },
  heatmap: { span: 24, height: 260 },
  scatter: { span: 12, height: 300 },
  "stacked-hbar": { span: 12, height: 300 },
  pie: { span: 8, height: 240 },
  radar: { span: 8, height: 300 },
  treemap: { span: 16, height: 300 },
  bar: { span: 8, height: 240 },
  line: { span: 8, height: 240 },
};

/**
 * Which list a chart's category drills into (§44).
 *
 * A chart nobody can click through is a picture. Only the panels whose
 * categories *are* a filter value are listed; a revenue trend has no such
 * category, and inventing one would send the reader somewhere arbitrary.
 */
const DRILL_DOWN: Record<string, string> = {
  tickets_by_category: "/tickets?f.category=",
  tasks_by_status: "/tasks?f.status=",
  projects_by_health: "/projects?f.health=",
  device_health: "/devices?f.kind=",
};

const SEVERITY: Record<DashboardAlert["severity"], { color: string; type: "error" | "warning" | "info" }> = {
  CRITICAL: { color: SEMANTIC.danger, type: "error" },
  WARNING: { color: SEMANTIC.warning, type: "warning" },
  INFO: { color: SEMANTIC.info, type: "info" },
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const [params, setParams] = useSearchParams();
  // The period lives in the URL, so a dashboard somebody is looking at can be
  // sent to a colleague and arrive showing the same thing (§69).
  const period = params.get("period") ?? "last_30_days";

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["dashboard", period],
    queryFn: ({ signal }) => dashboardApi.summary({ period }, signal),
  });

  const panels = useMemo(() => {
    if (!data) return [];
    return CHART_KEYS.map((key) => ({
      key,
      panel: data.charts[key] as ChartPanel | undefined,
    })).flatMap((entry) =>
      // `flatMap` rather than `filter`: a type predicate that narrows one
      // property of a tuple element needs the whole element's type restated,
      // and restating it is how the two drift.
      entry.panel ? [{ key: entry.key, panel: entry.panel }] : [],
    );
  }, [data]);

  const periodOptions = data?.period.options.filter((option) => option.key !== "custom") ?? [];
  const choosePeriod = (next: string) => {
    const updated = new URLSearchParams(params);
    updated.set("period", next);
    setParams(updated, { replace: true });
  };

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
            screens.md !== false ? <Segmented
              size="middle"
              value={period}
              onChange={choosePeriod}
              options={periodOptions.map((option) => ({ label: option.label, value: option.key }))}
            /> : <Select
              aria-label="Dashboard period"
              value={period}
              onChange={choosePeriod}
              style={{ minWidth: 170 }}
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
          description={<>{error instanceof Error ? error.message : "Unknown error"}
            {error instanceof ApiError && <div>Correlation ID: {error.correlationId}</div>}</>}
          action={<Button onClick={() => void refetch()}>Retry</Button>}
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

      {/* ── charts (§2, §44) ─────────────────────────────────────────────
          Sized by what each chart needs rather than by a uniform grid: a
          twenty-four-column heatmap in a third of the width is unreadable, and
          a gauge in two thirds is mostly whitespace. */}
      <Row gutter={[12, 12]}>
        {isLoading && [16, 8, 8, 16].map((span, index) => (
          <Col key={`loading-${index}`} xs={24} lg={span}>
            <Card style={{ minHeight: 330 }}><Skeleton active paragraph={{ rows: 6 }} /></Card>
          </Col>
        ))}
        {panels.map(({ key, panel }) => {
          const shape = SHAPES[panel.kind] ?? { span: 8, height: 240 };
          return (
            <Col key={key} xs={24} md={shape.span > 8 ? 24 : 12} lg={shape.span}>
              <ChartCard
                id={key}
                panel={panel}
                loading={isLoading}
                height={shape.height}
                onSelect={
                  DRILL_DOWN[key]
                    ? (name) => navigate(`${DRILL_DOWN[key]}${encodeURIComponent(name)}`)
                    : undefined
                }
              />
            </Col>
          );
        })}

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

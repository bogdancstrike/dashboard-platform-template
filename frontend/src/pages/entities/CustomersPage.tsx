/**
 * Customers as accounts (§7).
 *
 * An account is read as a *whole* — who they are, what they are worth, how
 * they feel, when anybody last spoke to them — and those four facts read
 * badly as four columns and well as one card. So this is a card grid, and the
 * cards are sorted by lifetime value because that is the order somebody asks
 * for when they say "show me the customers".
 *
 * Beside the grid sits the shape of the book: value by segment, and the
 * lifecycle funnel. Both are the server's aggregates over the *filtered* set,
 * so narrowing to one country redraws them rather than leaving them describing
 * a different question from the one on screen.
 */

import { Avatar, Card, Col, Pagination, Progress, Row, Skeleton, Space, Tag, Tooltip, Typography } from "antd";
import { MailOutlined, ShopOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import { ChartCard } from "@/components/ChartCard";
import { EmptyState, NoResults } from "@/components/EmptyState";
import { StatusTag } from "@/components/StatusTag";
import {
  NewRecordButton,
  RecordActions,
  useRecordEditing,
} from "@/components/records/useRecordEditing";
import { usePageCommands } from "@/commands/CommandContext";
import { EntityError, EntityFilters, EntityHeader, MetricStrip } from "@/entities/EntityChrome";
import { useEntityView } from "@/entities/useEntityView";
import { absoluteTime, relativeTime } from "@/lib/time";
import { SEMANTIC } from "@/theme/tokens";

const { Text, Paragraph } = Typography;

const COLUMNS = [
  "code", "name", "email", "status", "segment", "industry", "lifecycle_stage",
  "country", "city", "lifetime_value", "satisfaction", "last_contact_at",
];

interface CustomerRow {
  id: string;
  code?: string;
  name?: string;
  email?: string;
  status?: string;
  segment?: string;
  industry?: string;
  lifecycle_stage?: string;
  country?: string;
  city?: string;
  lifetime_value?: number;
  satisfaction?: number;
  last_contact_at?: string | null;
}

/** Satisfaction is out of ten; the colour is the reading, not the number. */
function moodColour(score: number): string {
  if (score >= 7.5) return SEMANTIC.success;
  if (score >= 5) return SEMANTIC.warning;
  return SEMANTIC.danger;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

export default function CustomersPage() {
  const navigate = useNavigate();
  const view = useEntityView("customer", {
    columns: COLUMNS,
    defaultSort: "lifetime_value",
    defaultPageSize: 24,
  });
  const rows = (view.rows.data?.items ?? []) as CustomerRow[];
  const insights = view.insights.data;

  const breakdown = (field: string) =>
    insights?.breakdowns.find((item) => item.field === field);

  const records = useRecordEditing(view.resource, {
    onCreated: (id) => navigate(`/customers/${id}`),
  });

  usePageCommands("entity:customer", [
    {
      id: "customer.new",
      label: "Create an account",
      keywords: "new add create customer",
      run: records.create,
    },
    {
      id: "customer.at-risk",
      label: "Show accounts with low satisfaction",
      keywords: "unhappy churn risk",
      run: () => navigate("/explore?resource=customer&sort=satisfaction&order=asc"),
    },
    {
      id: "customer.enterprise",
      label: "Show enterprise accounts",
      keywords: "segment tier",
      run: () => view.setFilter("segment", "ENTERPRISE"),
    },
  ]);

  if (view.catalogue.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;

  return (
    <>
      <EntityHeader
        view={view}
        subtitle="The book of business, richest first — with what each account is worth and how it feels."
        actions={<NewRecordButton records={records} resource={view.resource} />}
      />

      <MetricStrip view={view} accents={["accent", "success", "info", "warning"]} />
      <EntityFilters view={view} only={["segment", "lifecycle_stage", "industry", "country"]} />
      <EntityError view={view} />

      <Row gutter={[12, 12]} className="nu-block">
        <Col xs={24} lg={12}>
          <ChartCard
            id="customers-segment"
            height={220}
            panel={
              breakdown("segment") && {
                kind: "pie",
                title: "Accounts by segment",
                series: breakdown("segment")!.series,
              }
            }
            loading={view.insights.isLoading}
            onSelect={(name) => view.setFilter("segment", name)}
          />
        </Col>
        <Col xs={24} lg={12}>
          <ChartCard
            id="customers-lifecycle"
            height={220}
            panel={
              breakdown("lifecycle_stage") && {
                kind: "bar",
                title: "Where accounts are in their lifecycle",
                series: breakdown("lifecycle_stage")!.series,
              }
            }
            loading={view.insights.isLoading}
            onSelect={(name) => view.setFilter("lifecycle_stage", name)}
          />
        </Col>
      </Row>

      {view.rows.isLoading ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : rows.length === 0 ? (
        <Card size="small" className="nu-block">
          {/* Two states, not one shrug (§34): "nothing matched" wants the
              filters cleared and "nothing here yet" wants the first record.
              This said "no accounts match these filters" with no filters set,
              which tells a reader their filter is wrong when the book of
              business is simply empty. */}
          {view.filterCount > 0 ? (
            <NoResults filterCount={view.filterCount} onClear={view.clearFilters} />
          ) : (
            <EmptyState
              title="No accounts yet"
              hint="An account is a customer with a value and a lifecycle."
              action={<NewRecordButton records={records} resource={view.resource} />}
            />
          )}
        </Card>
      ) : (
        <div className="nu-account-grid" data-testid="customer-grid">
          {rows.map((customer) => {
            const score = Number(customer.satisfaction ?? 0);
            return (
              <Card
                key={customer.id}
                size="small"
                hoverable
                className="nu-account"
                onClick={() => navigate(`/customers/${customer.id}`)}
              >
                <div className="nu-account-head">
                  <Avatar
                    shape="square"
                    size={40}
                    style={{ background: "var(--nu-accent-soft)", color: "var(--nu-accent)" }}
                  >
                    {initials(customer.name ?? "?")}
                  </Avatar>
                  <div className="nu-account-name">
                    <Text strong ellipsis>
                      {customer.name}
                    </Text>
                    <Text type="secondary">
                      {customer.code} · {customer.city}, {customer.country}
                    </Text>
                  </div>
                  <StatusTag status={customer.status} bordered={false} />
                  <RecordActions
                    records={records}
                    id={customer.id}
                    label={customer.code ?? customer.name ?? "this account"}
                  />
                </div>

                <div className="nu-account-value">
                  <span className="nu-account-amount">
                    €{Math.round(Number(customer.lifetime_value ?? 0)).toLocaleString()}
                  </span>
                  <Text type="secondary">lifetime value</Text>
                </div>

                <Tooltip title={`Satisfaction ${score.toFixed(1)} out of 10`}>
                  <Progress
                    aria-label={`Satisfaction ${score.toFixed(1)} out of 10`}
                    percent={score * 10}
                    size="small"
                    showInfo={false}
                    strokeColor={moodColour(score)}
                  />
                </Tooltip>

                <Space size={6} wrap className="nu-account-meta">
                  <Tag bordered={false}>{customer.segment}</Tag>
                  <Text type="secondary">
                    <ShopOutlined /> {customer.industry}
                  </Text>
                </Space>

                <Paragraph className="nu-account-contact" ellipsis>
                  <MailOutlined /> {customer.email}
                </Paragraph>

                <Tooltip title={absoluteTime(customer.last_contact_at)}>
                  <Text type="secondary" className="nu-account-touch">
                    Last contact {relativeTime(customer.last_contact_at)}
                  </Text>
                </Tooltip>
              </Card>
            );
          })}
        </div>
      )}

      {(view.rows.data?.total ?? 0) > view.pageSize && (
        <div className="nu-notice-pager">
          <Pagination
            current={view.page}
            pageSize={view.pageSize}
            total={view.rows.data?.total ?? 0}
            showSizeChanger
            pageSizeOptions={[12, 24, 48, 96]}
            showTotal={(count, range) => `${range[0]}–${range[1]} of ${count.toLocaleString()}`}
            onChange={(next, size) =>
              view.set({ page: next === 1 ? null : next, page_size: size === 24 ? null : size })
            }
          />
        </div>
      )}

      {records.drawer}
    </>
  );
}

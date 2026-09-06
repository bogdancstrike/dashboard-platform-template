/**
 * Tickets as a triage queue (§7, §62, §63).
 *
 * Support work is done in a **split view** because the job is not "look at a
 * list" — it is "work down a list", and a page that costs a navigation per
 * ticket costs it forty times an hour. So the queue stays on the left, the
 * chosen ticket opens on the right, and the selection lives in the URL so the
 * exact ticket somebody is looking at can be pasted into a chat.
 *
 * The queue is ordered by severity and then by age, which is the order a
 * person triages in. SLA is the loudest thing on the row because it is the
 * only fact with a deadline attached: a breached ticket is not a red tag, it
 * is the reason this page is open.
 */

import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Pagination,
  Segmented,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { ApartmentOutlined, ExportOutlined, WarningOutlined } from "@ant-design/icons";
import { useNavigate, useSearchParams } from "react-router-dom";

import { recordsApi } from "@/api/records";
import { asText } from "@/lib/text";
import { AuditTimeline } from "@/components/audit/AuditTimeline";
import { usePageCommands } from "@/commands/CommandContext";
import { EntityError, EntityFilters, EntityHeader, MetricStrip } from "@/entities/EntityChrome";
import { useEntityView } from "@/entities/useEntityView";
import { absoluteTime, relativeTime } from "@/lib/time";
import { knownStatusColor } from "@/theme/tokens";

const { Text, Paragraph } = Typography;

const COLUMNS = [
  "reference", "subject", "description", "status", "priority", "severity",
  "category", "channel", "due_at", "sla_breached", "resolution_minutes", "created_at",
];

interface TicketRow {
  id: string;
  reference?: string;
  subject?: string;
  description?: string;
  status?: string;
  priority?: string;
  severity?: string;
  category?: string;
  channel?: string;
  due_at?: string | null;
  sla_breached?: boolean;
  created_at?: string | null;
}

export default function TicketsQueuePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = useEntityView("ticket", {
    columns: COLUMNS,
    defaultSort: "severity",
    defaultOrder: "asc",
    defaultPageSize: 20,
  });

  const rows = (view.rows.data?.items ?? []) as TicketRow[];
  const selectedId = params.get("open") ?? rows[0]?.id ?? "";

  const open = useQuery({
    queryKey: ["record", "ticket", selectedId],
    queryFn: ({ signal }) => recordsApi.get("ticket", selectedId, signal),
    enabled: Boolean(selectedId),
  });

  const choose = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("open", id);
    setParams(next, { replace: true });
  };

  usePageCommands("entity:ticket", [
    {
      id: "ticket.breached",
      label: "Show tickets that have breached their SLA",
      keywords: "sla late overdue",
      run: () => view.setFilter("sla_breached", "true"),
    },
    {
      id: "ticket.critical",
      label: "Show critical tickets",
      keywords: "severity urgent",
      run: () => view.setFilter("severity", "CRITICAL"),
    },
  ]);

  if (view.catalogue.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;

  /**
   * One field of the open record, as text.
   *
   * `asText` rather than `String`: a `json` or `array` field stringifies to
   * `[object Object]`, which is a bug that looks like data.
   */
  const field = (name: string): string =>
    asText(open.data?.fields.find((item) => item.name === name)?.value);
  const flag = (name: string): boolean =>
    Boolean(open.data?.fields.find((item) => item.name === name)?.value);

  return (
    <>
      <EntityHeader
        view={view}
        subtitle="The queue, worst first — work it from here without losing your place."
      />

      <MetricStrip view={view} accents={["accent", "info", "danger", "neutral"]} />

      <EntityFilters view={view} only={["severity", "status", "category"]}>
        {/* The one filter worth a control of its own: it is the reason the
            page is open, and burying it in a select makes it a search. */}
        <Segmented
          aria-label="SLA"
          data-testid="sla-filter"
          value={view.filters["sla_breached"] ?? "all"}
          onChange={(next) =>
            view.setFilter("sla_breached", next === "all" ? null : String(next))
          }
          options={[
            { label: "Any SLA", value: "all" },
            { label: "Breached", value: "true" },
            { label: "Within SLA", value: "false" },
          ]}
        />
      </EntityFilters>

      <EntityError view={view} />

      <div className="nu-split" data-testid="ticket-queue">
        <Card size="small" className="nu-split-list">
          {view.rows.isLoading ? (
            <Skeleton active paragraph={{ rows: 8 }} />
          ) : rows.length === 0 ? (
            <Empty description="No tickets match these filters" />
          ) : (
            <ul className="nu-queue">
              {rows.map((ticket) => (
                <li key={ticket.id}>
                  <button
                    type="button"
                    className={`nu-queue-row${ticket.id === selectedId ? " is-open" : ""}`}
                    onClick={() => choose(ticket.id)}
                    aria-current={ticket.id === selectedId}
                  >
                    <span
                      className="nu-queue-severity"
                      style={{ background: knownStatusColor(ticket.severity ?? "") }}
                      aria-hidden
                    />
                    <span className="nu-queue-main">
                      <span className="nu-queue-title">
                        <Text strong ellipsis>
                          {ticket.subject}
                        </Text>
                        {ticket.sla_breached && (
                          <Tooltip title="This ticket has missed its service level">
                            <WarningOutlined className="nu-queue-breach" />
                          </Tooltip>
                        )}
                      </span>
                      <span className="nu-queue-meta">
                        <Text type="secondary" className="nu-mono">
                          {ticket.reference}
                        </Text>
                        <Tag color={knownStatusColor(ticket.status ?? "")} bordered={false}>
                          {ticket.status}
                        </Tag>
                        <Text type="secondary">{relativeTime(ticket.created_at)}</Text>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {(view.rows.data?.total ?? 0) > view.pageSize && (
            <div className="nu-queue-pager">
              <Pagination
                simple
                current={view.page}
                pageSize={view.pageSize}
                total={view.rows.data?.total ?? 0}
                onChange={(next) => view.set({ page: next === 1 ? null : next })}
              />
            </div>
          )}
        </Card>

        <Card
          size="small"
          className="nu-split-detail"
          title={open.data?.title ?? "Pick a ticket"}
          extra={
            open.data && (
              <Space>
                <Button
                  size="small"
                  icon={<ApartmentOutlined />}
                  onClick={() =>
                    navigate(`/find/relationships?resource=ticket&id=${open.data.id}`)
                  }
                >
                  Connections
                </Button>
                <Button
                  size="small"
                  type="primary"
                  icon={<ExportOutlined />}
                  onClick={() => navigate(`/tickets/${open.data.id}`)}
                >
                  Full record
                </Button>
              </Space>
            )
          }
        >
          {!selectedId ? (
            <Empty description="Choose a ticket from the queue" />
          ) : open.isLoading ? (
            <Skeleton active paragraph={{ rows: 8 }} />
          ) : open.isError ? (
            <Alert type="error" showIcon message="That ticket could not be opened" />
          ) : (
            open.data && (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                {flag("sla_breached") && (
                  <Alert
                    type="error"
                    showIcon
                    message="Service level missed"
                    description={`Due ${absoluteTime(field("due_at"))}.`}
                  />
                )}

                <Space size={6} wrap>
                  <Tag color={knownStatusColor(open.data.status)} bordered={false}>
                    {open.data.status}
                  </Tag>
                  <Tag color={knownStatusColor(field("severity"))} bordered={false}>
                    {field("severity")}
                  </Tag>
                  <Tag bordered={false}>{field("category")}</Tag>
                  <Text type="secondary">via {field("channel")}</Text>
                </Space>

                <Paragraph className="nu-ticket-body">
                  {field("description") || "No description was given."}
                </Paragraph>

                <Descriptions size="small" column={2} bordered>
                  <Descriptions.Item label="Reference">{open.data.subtitle}</Descriptions.Item>
                  <Descriptions.Item label="Priority">
                    {field("priority") || "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Raised">
                    {absoluteTime(open.data.created_at)}
                  </Descriptions.Item>
                  <Descriptions.Item label="Due">
                    {absoluteTime(field("due_at"))}
                  </Descriptions.Item>
                </Descriptions>

                <AuditTimeline resourceType="ticket" resourceId={open.data.id} limit={6} />
              </Space>
            )
          )}
        </Card>
      </div>
    </>
  );
}

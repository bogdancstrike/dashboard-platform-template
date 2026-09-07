/**
 * `/projects/:id` — a delivery review, not a row with its columns stacked
 * (§8, §44, §48).
 *
 * The six entity *lists* already refuse to look alike; the detail pages had
 * not caught up, and three of them differed only in the words inside the
 * `Descriptions` table. A project is not read for its fields. It is read to
 * answer one question — *are we all right* — and that answer is not in any
 * single column: it is in the gap between how much of the schedule has gone,
 * how much of the money has gone, and how much has actually been delivered.
 *
 * So the page opens with those three side by side and a sentence naming the
 * gap, and only then shows the work underneath them.
 *
 * Three decisions worth stating.
 *
 * **The rollup is the analysis endpoint, not a count in the browser.** "How
 * many tasks are in each state" is *group these rows by this column*, which
 * the platform already compiles once (§71). Counting the page's own rows would
 * give a number that silently means "of the eight I downloaded".
 *
 * **The work is linked, never re-implemented.** Every lane and every row leads
 * to `/tasks` filtered by this project, because a board already exists and a
 * second one embedded here would be a second set of rules about what a lane
 * is. The page shows what is due next and gets out of the way.
 *
 * **Health, phase and progress write on change**, through the shared
 * optimistic-then-reconciled path (§73). They are what a review actually
 * changes; everything rarer stays behind the declaration-driven Edit drawer,
 * so this page adds a shape rather than a second way to write a project.
 */

import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Progress,
  Row,
  Select,
  Skeleton,
  Space,
  Table,
  Tooltip,
  Typography,
} from "antd";
import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { Link, useNavigate, useParams } from "react-router-dom";

import { analysisApi } from "@/api/analysis";
import { explorerApi } from "@/api/explorer";
import { recordsApi } from "@/api/records";
import { AuditTimeline } from "@/components/audit/AuditTimeline";
import { CommentThread } from "@/components/comments/CommentThread";
import { PageHeader } from "@/components/PageHeader";
import { PeoplePicker } from "@/components/PeoplePicker";
import { useRecordPage } from "@/components/records/useRecordPage";
import { StatusTag } from "@/components/StatusTag";
import { usePageCommands } from "@/commands/CommandContext";
import { projectStanding } from "@/entities/delivery";
import { absoluteTime, relativeTime } from "@/lib/time";
import { formatNumber } from "@/lib/formats";
import { asText } from "@/lib/text";
import { knownStatusColor, SEMANTIC } from "@/theme/tokens";

const { Text, Paragraph } = Typography;

/**
 * The verdict's colour — the readable ink, not the fill.
 *
 * `SEMANTIC` is tuned for bars; this is a sentence, and green `#16a34a` on
 * white is 3.3:1, below the bar for text (§55). The ink ramp carries the same
 * four meanings at a lightness that can be read, in both themes.
 */
const STANDING_INK = {
  ahead: "var(--nu-success-ink)",
  even: "var(--nu-info-ink)",
  behind: "var(--nu-danger-ink)",
  done: "var(--nu-success-ink)",
} as const;

/** What is worth reading of the project's own work queue, and in what order. */
const TASK_COLUMNS = ["reference", "title", "status", "priority", "due_date", "progress"];

interface TaskRow {
  id: string;
  reference?: string;
  title?: string;
  status?: string;
  priority?: string;
  due_date?: string | null;
  progress?: number;
}

export default function ProjectDeliveryPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const page = useRecordPage("project", id, { listPath: "/projects", noun: "project" });

  /**
   * The work under this project, grouped in SQL.
   *
   * Two questions, one endpoint: the lane counts are a `GROUP BY status` over
   * every task the project has, and the table below is the soonest few. The
   * counts therefore describe the whole queue rather than the rows on screen.
   */
  const rollup = useQuery({
    queryKey: ["record-analysis", "project-tasks", id],
    queryFn: ({ signal }) =>
      analysisApi.run(
        {
          resource_type: "task",
          dimensions: ["status"],
          measures: [{ aggregation: "count" }],
          filters: { project_id: id },
        },
        signal,
      ),
    enabled: Boolean(id),
  });

  const nextUp = useQuery({
    queryKey: ["record-analysis", "project-next-tasks", id],
    queryFn: ({ signal }) =>
      explorerApi.query(
        {
          resource_type: "task",
          filters: { project_id: id },
          columns: TASK_COLUMNS,
          sort: "due_date",
          order: "asc",
          page_size: 8,
        },
        signal,
      ),
    enabled: Boolean(id),
  });

  const customerId = asText(page.value("customer_id"));
  const account = useQuery({
    queryKey: ["record", "customer", customerId],
    queryFn: ({ signal }) => recordsApi.get("customer", customerId, signal),
    // Fetched only once there is an account to fetch, so a project without a
    // customer costs nothing rather than a 404 on every open.
    enabled: Boolean(customerId),
  });

  usePageCommands("record:project", [
    {
      id: "project.edit",
      label: "Edit this project",
      keywords: "change update",
      run: () => page.editing.edit(id),
    },
    {
      id: "project.tasks",
      label: "Open this project's work queue",
      keywords: "tasks board work",
      run: () => navigate(`/tasks?f.project_id=${id}`),
    },
    {
      id: "project.at-risk",
      label: "Flag this project as at risk",
      keywords: "health amber red",
      run: () => page.write({ health: "AT_RISK" }),
    },
  ]);

  if (page.fallback) return page.fallback;

  const project = page.record!;
  const standing = projectStanding({
    startDate: asText(page.value("start_date")) || null,
    dueDate: asText(page.value("due_date")) || null,
    completedAt: asText(page.value("completed_at")) || null,
    budget: Number(page.value("budget") ?? 0),
    spent: Number(page.value("spent") ?? 0),
    progress: Number(page.value("progress") ?? 0),
  });

  const currency = asText(page.value("currency")) || "EUR";
  const money = (value: unknown) =>
    `${formatNumber(Math.round(Number(value ?? 0)))} ${currency}`;

  const lanes = (rollup.data?.rows ?? []).map((row) => ({
    status: row.keys[0] ?? "—",
    count: Number(row.values.count ?? 0),
  }));
  const totalTasks = rollup.data?.matched ?? 0;

  return (
    <>
      <PageHeader
        title={project.title}
        onBack={() => navigate("/projects")}
        subtitle={
          <Space size={8} wrap>
            <Text type="secondary" className="nu-mono">
              {project.subtitle}
            </Text>
            {account.data && (
              <Text type="secondary">
                for <Link to={`/customers/${customerId}`}>{account.data.title}</Link>
              </Text>
            )}
            <Text type="secondary">
              Updated{" "}
              <Tooltip title={absoluteTime(project.updated_at)}>
                <span>{relativeTime(project.updated_at)}</span>
              </Tooltip>
            </Text>
          </Space>
        }
        tag={<StatusTag status={project.status} data-testid="record-status" />}
        actions={
          <>
            <Button onClick={() => navigate(`/tasks?f.project_id=${id}`)}>
              Open the work queue
            </Button>
            <Tooltip title={project.can_edit ? "" : "Your role does not include records.update"}>
              <Button
                type="primary"
                icon={<EditOutlined />}
                disabled={!project.can_edit}
                onClick={() => page.editing.edit(id)}
                data-testid="record-edit"
              >
                Edit
              </Button>
            </Tooltip>
            <Tooltip title={project.can_delete ? "" : "Your role does not include records.delete"}>
              <Button
                danger
                icon={<DeleteOutlined />}
                disabled={!project.can_delete}
                onClick={() => page.editing.remove(id, project.title)}
              >
                Delete
              </Button>
            </Tooltip>
          </>
        }
      />

      {/* The finding, above everything else: three measures of the same
          project that are only interesting next to one another. */}
      <Card size="small" data-testid="delivery-standing">
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            {/* Each bar is coloured by its *own* state rather than by the
                verdict, because a red bar over "85% delivered" reads as
                "delivering is going badly". What is going badly is the
                relationship between the three, and that is the sentence's
                job. */}
            <Gauge
              label="Delivered"
              percent={standing.progress}
              caption="what the team reports as done"
              colour="var(--nu-accent)"
            />
          </Col>
          <Col xs={24} md={8}>
            <Gauge
              label="Schedule"
              percent={standing.elapsed}
              caption={
                standing.daysLeft === null
                  ? "no start and due date"
                  : standing.daysLeft < 0
                    ? `${Math.abs(standing.daysLeft)} days past due`
                    : `${standing.daysLeft} days left`
              }
              colour={spentColour(standing.elapsed, standing.daysLeft !== null && standing.daysLeft < 0)}
            />
          </Col>
          <Col xs={24} md={8}>
            <Gauge
              label="Budget"
              percent={standing.burn}
              caption={`${money(page.value("spent"))} of ${money(page.value("budget"))}`}
              colour={spentColour(standing.burn, (standing.burn ?? 0) > 100)}
            />
          </Col>
        </Row>
        <Text
          strong
          data-testid="delivery-summary"
          style={{ color: STANDING_INK[standing.standing], display: "block", marginTop: 12 }}
        >
          {standing.summary}
        </Text>
      </Card>

      <Row gutter={[12, 12]} className="nu-block">
        <Col xs={24} xl={16}>
          <Card
            size="small"
            title="The work"
            data-testid="project-work"
            extra={
              <Link to={`/tasks?f.project_id=${id}`}>
                {totalTasks === 1 ? "1 task" : `all ${formatNumber(totalTasks)} tasks`}
              </Link>
            }
          >
            {rollup.isLoading ? (
              <Skeleton active title={false} paragraph={{ rows: 2 }} />
            ) : lanes.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No work has been raised under this project yet"
              />
            ) : (
              <div className="nu-rollup">
                {lanes.map((lane) => (
                  <Link
                    key={lane.status}
                    className="nu-rollup-cell"
                    to={`/tasks?f.project_id=${id}&f.status=${lane.status}`}
                  >
                    <span
                      className="nu-rollup-value"
                      style={{ color: knownStatusColor(lane.status) }}
                    >
                      {formatNumber(lane.count)}
                    </span>
                    <span className="nu-rollup-label">{lane.status.replace(/_/g, " ")}</span>
                  </Link>
                ))}
              </div>
            )}

            <Table<TaskRow>
              className="nu-block"
              size="small"
              rowKey="id"
              pagination={false}
              loading={nextUp.isLoading}
              dataSource={nextUp.data?.items ?? []}
              locale={{ emptyText: "Nothing is scheduled" }}
              onRow={(row) => ({
                onClick: () => navigate(`/tasks/${row.id}`),
                style: { cursor: "pointer" },
              })}
              columns={[
                {
                  title: "Due next",
                  dataIndex: "title",
                  render: (title: string, row) => (
                    <Space direction="vertical" size={0}>
                      <Text>{title}</Text>
                      <Text type="secondary" className="nu-mono">
                        {row.reference}
                      </Text>
                    </Space>
                  ),
                },
                {
                  title: "Status",
                  dataIndex: "status",
                  width: 140,
                  render: (status: string) => <StatusTag status={status} />,
                },
                {
                  title: "Due",
                  dataIndex: "due_date",
                  width: 130,
                  render: (due: string | null) =>
                    due ? (
                      <Tooltip title={absoluteTime(due)}>
                        <span>{relativeTime(due)}</span>
                      </Tooltip>
                    ) : (
                      <Text type="secondary">—</Text>
                    ),
                },
                {
                  title: "Progress",
                  dataIndex: "progress",
                  width: 120,
                  render: (value: number, row) => (
                    <Progress
                      aria-label={`${row.title ?? "Task"} is ${Number(value)}% done`}
                      className="nu-gauge"
                      percent={Number(value)}
                      size="small"
                    />
                  ),
                },
              ]}
            />
          </Card>

          <Card size="small" title="Brief" className="nu-block">
            <Paragraph className="nu-record-prose">
              {asText(page.value("description")) || "No brief was written for this project."}
            </Paragraph>
          </Card>

          <Card size="small" title="Comments" className="nu-block">
            <CommentThread resourceType="project" resourceId={id} />
          </Card>

          <Card size="small" title="History" className="nu-block">
            {/* What the system recorded, kept apart from what people said:
                one feed makes a decision indistinguishable from a side
                effect (§21, §48). */}
            <AuditTimeline resourceType="project" resourceId={id} limit={8} />
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card size="small" title="Review" data-testid="project-review">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Field label="Health">
                <Select
                  aria-label="Health"
                  style={{ width: "100%" }}
                  value={asText(page.value("health"))}
                  disabled={!project.can_edit}
                  loading={page.writing}
                  onChange={(next) => page.write({ health: next })}
                  options={page.choices("health").map((choice) => ({
                    value: choice,
                    label: choice.replace(/_/g, " "),
                  }))}
                />
              </Field>

              <Field label="Phase">
                <Select
                  aria-label="Phase"
                  style={{ width: "100%" }}
                  value={asText(page.value("phase"))}
                  disabled={!project.can_edit}
                  onChange={(next) => page.write({ phase: next })}
                  options={page.choices("phase").map((choice) => ({
                    value: choice,
                    label: choice,
                  }))}
                />
              </Field>

              <Field label="Status">
                <Select
                  aria-label="Status"
                  style={{ width: "100%" }}
                  value={project.status}
                  disabled={!project.can_edit}
                  onChange={(next) => page.write({ status: next })}
                  options={page.choices("status").map((choice) => ({
                    value: choice,
                    label: choice.replace(/_/g, " "),
                  }))}
                />
              </Field>

              <Field label="Owner">
                <PeoplePicker
                  multiple={false}
                  aria-label="Owner"
                  placeholder="Nobody yet"
                  disabled={!project.can_edit}
                  value={page.value("owner_id") ? [asText(page.value("owner_id"))] : []}
                  onChange={(ids) => page.write({ owner_id: ids[0] ?? null })}
                />
              </Field>

              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="Priority">
                  {asText(page.value("priority")) || "—"}
                </Descriptions.Item>
                <Descriptions.Item label="Started">
                  {page.value("start_date")
                    ? absoluteTime(asText(page.value("start_date")))
                    : "—"}
                </Descriptions.Item>
                <Descriptions.Item label="Due">
                  {page.value("due_date") ? absoluteTime(asText(page.value("due_date"))) : "—"}
                </Descriptions.Item>
                <Descriptions.Item label="Completed">
                  {page.value("completed_at")
                    ? absoluteTime(asText(page.value("completed_at")))
                    : "—"}
                </Descriptions.Item>
                <Descriptions.Item label="Budget">{money(page.value("budget"))}</Descriptions.Item>
                <Descriptions.Item label="Spent">{money(page.value("spent"))}</Descriptions.Item>
                <Descriptions.Item label="Remaining">
                  {money(Number(page.value("budget") ?? 0) - Number(page.value("spent") ?? 0))}
                </Descriptions.Item>
              </Descriptions>
            </Space>
          </Card>

          {account.data && (
            <Card
              size="small"
              title="Account"
              className="nu-block"
              extra={<Link to={`/customers/${customerId}`}>Open</Link>}
            >
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="Customer">{account.data.title}</Descriptions.Item>
                <Descriptions.Item label="Status">
                  <StatusTag status={account.data.status} />
                </Descriptions.Item>
              </Descriptions>
            </Card>
          )}
        </Col>
      </Row>

      {page.editing.drawer}
    </>
  );
}

/**
 * How a "how much is used up" bar is coloured.
 *
 * Neutral while there is room, amber in the last tenth and red once it is
 * gone — the two bars that can be *overspent* say so before they are, because
 * a budget noticed at 100% is a budget noticed too late. Deliberately not
 * AntD's default, which turns a bar green at 100%: a schedule that is fully
 * used is not a success.
 */
function spentColour(percent: number | null, over: boolean): string {
  if (over) return SEMANTIC.danger;
  if (percent !== null && percent >= 90) return SEMANTIC.warning;
  return "var(--nu-accent)";
}

/**
 * One measure of the project, as a bar with what it means underneath.
 *
 * A percentage with no caption is a number nobody can act on: "62%" of what,
 * against what. The caption is not decoration — it is the unit.
 */
function Gauge({
  label,
  percent,
  caption,
  colour,
}: {
  label: string;
  /** `null` when the record does not carry what it would take to compute it. */
  percent: number | null;
  caption: string;
  colour?: string;
}) {
  return (
    <div>
      <Text strong className="nu-field-label">
        {label}
      </Text>
      {percent === null ? (
        <Text type="secondary">Not enough information</Text>
      ) : (
        <Progress
          // Named, because a bar without one is announced as a number with no
          // subject — and this panel draws three of them side by side (§55).
          aria-label={`${label}: ${Math.round(percent)}% — ${caption}`}
          className="nu-gauge"
          percent={Math.min(Math.round(percent), 100)}
          strokeColor={colour}
          format={() => `${Math.round(percent)}%`}
        />
      )}
      <Text type="secondary" style={{ display: "block" }}>
        {caption}
      </Text>
    </div>
  );
}

/** A labelled control in the review panel. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Text strong className="nu-field-label">
        {label}
      </Text>
      {children}
    </div>
  );
}

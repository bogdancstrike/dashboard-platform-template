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

import { Button, Card, Col, Descriptions, Row, Space, Tooltip, Typography } from "antd";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useSmartBack } from "@/app/history";
import { AuditTimeline } from "@/components/audit/AuditTimeline";
import { CommentThread } from "@/components/comments/CommentThread";
import { PageHeader } from "@/components/PageHeader";
import { useRecordPage } from "@/components/records/useRecordPage";
import { VersionHistoryButton } from "@/components/recordsAnalytics/VersionHistory";
import { StatusTag } from "@/components/StatusTag";
import { usePageCommands } from "@/commands/CommandContext";
import { projectStanding } from "@/entities/delivery";
import { RecordDeleteButton, RecordEditButton } from "@/entities/detail";
import { formatNumber } from "@/lib/formats";
import { asText } from "@/lib/text";
import { absoluteTime, relativeTime } from "@/lib/time";

import { ProjectWork } from "./ProjectWork";
import { ReviewPanel } from "./ReviewPanel";
import { StandingCard } from "./StandingCard";
import { useProjectWork } from "./useProjectWork";

const { Text, Paragraph } = Typography;

export default function ProjectDeliveryPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const back = useSmartBack();
  const page = useRecordPage("project", id, { listPath: "/projects", noun: "project" });
  const customerId = asText(page.value("customer_id"));
  const { rollup, nextUp, account } = useProjectWork(id, customerId);

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
      // Not `project.at-risk`: the portfolio uses that one to *filter* to the
      // projects at risk, and the palette keys its items by id.
      id: "project.flag-at-risk",
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

  return (
    <>
      <PageHeader
        title={project.title}
        onBack={() => back("/projects")}
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
            <Button onClick={() => navigate(`/sprints?project=${id}`)} data-testid="project-sprints">
              Sprints
            </Button>
            <RecordEditButton allowed={project.can_edit} onEdit={() => page.editing.edit(id)} />
            <RecordDeleteButton allowed={project.can_delete} onDelete={() => page.editing.remove(id, project.title)} />
          </>
        }
      />
      <StandingCard
        standing={standing}
        budgetCaption={`${money(page.value("spent"))} of ${money(page.value("budget"))}`}
      />

      <Row gutter={[12, 12]} className="nu-block">
        <Col xs={24} xl={16}>
          <ProjectWork id={id} rollup={rollup} nextUp={nextUp} />

          <Card size="small" title="Brief" className="nu-block">
            <Paragraph className="nu-record-prose">
              {asText(page.value("description")) || "No brief was written for this project."}
            </Paragraph>
          </Card>

          <Card size="small" title="Comments" className="nu-block">
            <CommentThread resourceType="project" resourceId={id} />
          </Card>

          <Card size="small" title="History" className="nu-block" extra={<VersionHistoryButton resourceType="project" recordId={id} />}>
            {/* What the system recorded, kept apart from what people said:
                one feed makes a decision indistinguishable from a side
                effect (§21, §48). */}
            <AuditTimeline resourceType="project" resourceId={id} limit={8} />
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <ReviewPanel page={page} money={money} />

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

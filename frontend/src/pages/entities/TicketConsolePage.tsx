/**
 * `/tickets/:id` — a support console, not a record with its columns stacked
 * (§8, §36, §48).
 *
 * A ticket is read by somebody who has to *do* something about it in the next
 * few minutes, and the two things they need first are the clock and the
 * conversation. A `Descriptions` table of severity, channel and category gives
 * them neither: those matter, but they are the filing, and filing is not the
 * job.
 *
 * So the page is ordered the way the work is. The SLA standing is the first
 * thing on the screen, because it decides whether this ticket is the next
 * thing anybody does. The conversation is the widest column, because answering
 * is the action. The triage controls sit beside it and write on change, since
 * re-prioritising is a decision somebody makes *while* reading, not a form
 * they open afterwards.
 *
 * Two decisions worth stating.
 *
 * **Whether the SLA was missed is the server's answer, not this page's.**
 * `sla_breached` is a column every report already counts; recomputing it in
 * the browser from `due_at` would give the reader a second opinion, and the
 * two would disagree the first time the deadline rules change (§71).
 *
 * **The account's history is a filter, not an embedded list.** "What else has
 * this customer raised" is the ticket list narrowed by a declared column, so
 * the panel shows the newest few and links to the rest rather than growing its
 * own pagination.
 */

import { useQuery } from "@tanstack/react-query";
import {
  Card,
  Col,
  Descriptions,
  List,
  Row,
  Select,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { ClockCircleOutlined } from "@ant-design/icons";
import { Link, useParams } from "react-router-dom";
import { useSmartBack } from "@/app/history";

import { explorerApi } from "@/api/explorer";
import { recordsApi } from "@/api/records";
import { AuditTimeline } from "@/components/audit/AuditTimeline";
import { VersionHistoryButton } from "@/components/recordsAnalytics/VersionHistory";
import { CommentThread } from "@/components/comments/CommentThread";
import { PageHeader } from "@/components/PageHeader";
import { TagPicker } from "@/components/records/TagPicker";
import { PeoplePicker } from "@/components/PeoplePicker";
import { useRecordPage } from "@/components/records/useRecordPage";
import { humanStatus, StatusTag } from "@/components/StatusTag";
import { usePageCommands } from "@/commands/CommandContext";
import { Field, RecordDeleteButton, RecordEditButton } from "@/entities/detail";
import { duration, slaStanding } from "@/entities/sla";
import { RecordTimeCard, RecordTimerButton } from "@/components/decisions/RecordTimer";
import { TicketSlaCard, useTicketSla } from "@/components/decisions/TicketSlaCard";
import { absoluteTime, parseInstant, relativeTime } from "@/lib/time";
import { asText } from "@/lib/text";
import { EmptyState } from "@/components/EmptyState";
import { queryKeys } from "@/lib/queryKeys";

const { Text, Paragraph } = Typography;

/**
 * The domain's word for severity, in AntD's vocabulary.
 *
 * `sla.ts` says `danger` because that is what the platform's own semantic ramp
 * calls it; the component library says `error`. Translating here keeps the
 * widget's spelling out of a module that has nothing to do with widgets.
 */
const ALERT_TYPE = {
  success: "success",
  danger: "error",
  warning: "warning",
  info: "info",
} as const;

/** The fields the account panel reads of a sibling ticket. */
const SIBLING_COLUMNS = ["reference", "subject", "status", "severity", "created_at"];

interface SiblingTicket {
  id: string;
  reference?: string;
  subject?: string;
  status?: string;
  severity?: string;
  created_at?: string | null;
}

export default function TicketConsolePage() {
  const { id = "" } = useParams();
  const back = useSmartBack();
  const page = useRecordPage("ticket", id, { listPath: "/tickets", noun: "ticket" });

  const customerId = asText(page.value("customer_id"));
  const projectId = asText(page.value("project_id"));
  const account = useQuery({
    queryKey: queryKeys.record("customer", customerId),
    queryFn: ({ signal }) => recordsApi.get("customer", customerId, signal),
    enabled: Boolean(customerId),
  });

  const siblings = useQuery({
    queryKey: queryKeys.recordAnalysis("customer-tickets", customerId),
    queryFn: ({ signal }) =>
      explorerApi.query(
        {
          resource_type: "ticket",
          filters: { customer_id: customerId },
          columns: SIBLING_COLUMNS,
          sort: "created_at",
          order: "desc",
          page_size: 6,
        },
        signal,
      ),
    enabled: Boolean(customerId),
  });

  usePageCommands("record:ticket", [
    {
      id: "ticket.edit",
      label: "Edit this ticket",
      keywords: "change update",
      run: () => page.editing.edit(id),
    },
    {
      id: "ticket.escalate",
      label: "Escalate this ticket",
      keywords: "severity critical raise",
      run: () => page.write({ status: "ESCALATED", priority: "CRITICAL" }),
    },
    {
      id: "ticket.resolve",
      label: "Mark this ticket resolved",
      keywords: "close done finish",
      run: () => page.write({ status: "RESOLVED" }),
    },
  ]);

  // The policy's answer, when one covers the ticket: time left in its
  // business hours rather than on the wall clock (Time & decisions).
  const policySla = useTicketSla(id);

  if (page.fallback) return page.fallback;

  const ticket = page.record!;
  const resolutionClock = policySla.data?.resolution;
  const sla = slaStanding({
    businessMinutesLeft: resolutionClock && !resolutionClock.done_at ? resolutionClock.business_minutes_left : null,
    paused: policySla.data?.paused ?? false,
    policyName: policySla.data?.policy?.name ?? null,
    createdAt: ticket.created_at,
    dueAt: asText(page.value("due_at")) || null,
    firstResponseAt: asText(page.value("first_response_at")) || null,
    resolvedAt: asText(page.value("resolved_at")) || null,
    resolutionMinutes:
      page.value("resolution_minutes") === null ? null : Number(page.value("resolution_minutes")),
    breached: Boolean(page.value("sla_breached")),
  });

  const others = ((siblings.data?.items ?? []) as SiblingTicket[]).filter(
    (row) => row.id !== id,
  );

  return (
    <>
      <PageHeader
        title={ticket.title}
        onBack={() => back("/tickets")}
        subtitle={
          <Space size={8} wrap>
            <Text type="secondary" className="nu-mono">
              {ticket.subtitle}
            </Text>
            {/* Labelled, because "chat · data" is two words a reader has to
                guess the meaning of. */}
            {Boolean(page.value("channel")) && (
              <Tag bordered={false}>via {titleCase(asText(page.value("channel")))}</Tag>
            )}
            {Boolean(page.value("category")) && (
              <Tag bordered={false}>{titleCase(asText(page.value("category")))}</Tag>
            )}
            <Text type="secondary">
              Raised{" "}
              <Tooltip title={absoluteTime(ticket.created_at)}>
                <span>{relativeTime(ticket.created_at)}</span>
              </Tooltip>
            </Text>
          </Space>
        }
        tag={<StatusTag status={ticket.status} data-testid="record-status" />}
        actions={
          <>
            <RecordTimerButton subjectType="ticket" subjectId={id} label={`${ticket.subtitle ?? ""} · ${ticket.title}`} />
            <RecordEditButton allowed={ticket.can_edit} onEdit={() => page.editing.edit(id)} />
            <RecordDeleteButton allowed={ticket.can_delete} onDelete={() => page.editing.remove(id, ticket.subtitle || ticket.title)} />
          </>
        }
      />

      {/* The clock, first, because it decides whether this is the next thing
          anybody does. */}
      <SlaBanner
        tone={sla.tone}
        headline={sla.headline}
        detail={sla.detail}
        severity={asText(page.value("severity"))}
        raised={ticket.created_at}
        due={asText(page.value("due_at")) || null}
        resolved={asText(page.value("resolved_at")) || null}
        reopened={Number(page.value("reopen_count") ?? 0)}
      />

      <Row gutter={[12, 12]} className="nu-block">
        <Col xs={24} xl={16}>
          <TagPicker resourceType="ticket" recordId={id} listPath="/tickets" />
          <Card size="small" title="What was reported">
            <Paragraph className="nu-record-prose">
              {asText(page.value("description")) || "No description was given."}
            </Paragraph>
          </Card>

          {/* The four moments a support desk is measured on, in the order they
              happen. Four rows of a `Descriptions` table are four facts; laid
              out in sequence they are the *shape* of the response — which is
              what a review of it is actually looking at. */}
          <Card size="small" title="How it has been handled" className="nu-block"
                data-testid="ticket-response">
            <ol className="nu-moments">
              <Moment
                label="Raised"
                at={ticket.created_at}
                note={asText(page.value("channel")) ? `via ${titleCase(asText(page.value("channel")))}` : ""}
                reached
              />
              <Moment
                label="First answered"
                at={asText(page.value("first_response_at")) || null}
                note={sla.responseMinutes === null ? "Nobody has answered yet" : `after ${duration(sla.responseMinutes)}`}
                reached={sla.responseMinutes !== null}
              />
              <Moment
                label="Promised by"
                at={asText(page.value("due_at")) || null}
                // What the deadline *means* now, not the same interval twice:
                // the column beside it already says when it was.
                note={
                  sla.minutesLeft === null
                    ? "No deadline was set"
                    : sla.minutesLeft < 0
                      ? page.value("resolved_at")
                        ? "Passed before it was resolved"
                        : "Missed, and still open"
                      : `${duration(sla.minutesLeft)} left`
                }
                reached={sla.minutesLeft !== null && sla.minutesLeft < 0}
                tone={
                  sla.minutesLeft !== null && sla.minutesLeft < 0 && !page.value("resolved_at")
                    ? "danger"
                    : undefined
                }
              />
              <Moment
                label="Resolved"
                at={asText(page.value("resolved_at")) || null}
                note={
                  sla.resolutionMinutes === null
                    ? "Still open"
                    : `after ${duration(sla.resolutionMinutes)}`
                }
                reached={Boolean(page.value("resolved_at"))}
              />
            </ol>
          </Card>

          {/* The widest column, because answering is the job (§36). */}
          <Card size="small" title="Conversation" className="nu-block">
            <CommentThread resourceType="ticket" resourceId={id} />
          </Card>

          <Card size="small" title="History" className="nu-block" extra={<VersionHistoryButton resourceType="ticket" recordId={id} />}>
            <AuditTimeline resourceType="ticket" resourceId={id} limit={8} />
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <TicketSlaCard ticketId={id} />
          <RecordTimeCard subjectType="ticket" subjectId={id} />
          <Card size="small" title="Triage" data-testid="ticket-triage" className="nu-block">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Field label="Status">
                <Select
                  aria-label="Status"
                  style={{ width: "100%" }}
                  value={ticket.status}
                  disabled={!ticket.can_edit}
                  loading={page.writing}
                  onChange={(next) => page.write({ status: next })}
                  options={page.choices("status").map((choice) => ({
                    value: choice,
                    label: humanStatus(choice),
                  }))}
                />
              </Field>

              <Field label="Severity">
                <Select
                  aria-label="Severity"
                  style={{ width: "100%" }}
                  value={asText(page.value("severity"))}
                  disabled={!ticket.can_edit}
                  onChange={(next) => page.write({ severity: next })}
                  options={page.choices("severity").map((choice) => ({
                    value: choice,
                    label: humanStatus(choice),
                  }))}
                />
              </Field>

              <Field label="Priority">
                <Select
                  aria-label="Priority"
                  style={{ width: "100%" }}
                  value={asText(page.value("priority"))}
                  disabled={!ticket.can_edit}
                  onChange={(next) => page.write({ priority: next })}
                  options={page.choices("priority").map((choice) => ({
                    value: choice,
                    label: humanStatus(choice),
                  }))}
                />
              </Field>

              <Field label="Assignee">
                <PeoplePicker
                  multiple={false}
                  aria-label="Assignee"
                  placeholder="Unassigned"
                  disabled={!ticket.can_edit}
                  value={page.value("assignee_id") ? [asText(page.value("assignee_id"))] : []}
                  onChange={(ids) => page.write({ assignee_id: ids[0] ?? null })}
                />
              </Field>

            </Space>
          </Card>

          {/* The filing. It matters and it is not the job, which is why it is
              below the controls rather than in the headline — but "unknown
              channel · data" in a subtitle was information nobody could read
              and the record's own `project_id` was not shown at all. */}
          <Card size="small" title="Filing" className="nu-block" data-testid="ticket-filing">
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="Category">
                {titleCase(asText(page.value("category"))) || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Channel">
                {titleCase(asText(page.value("channel"))) || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Satisfaction">
                {page.value("satisfaction") === null
                  ? "Not rated"
                  : `${Number(page.value("satisfaction"))}/5`}
              </Descriptions.Item>
              <Descriptions.Item label="Reopened">
                {Number(page.value("reopen_count") ?? 0) === 0
                  ? "Never"
                  : formatCount(Number(page.value("reopen_count")))}
              </Descriptions.Item>
              <Descriptions.Item label="Project">
                {projectId ? (
                  <Link to={`/projects/${projectId}`}>Open the project</Link>
                ) : (
                  "Not against a project"
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Last changed">
                <Tooltip title={absoluteTime(asText(page.value("updated_at")))}>
                  <span>{relativeTime(asText(page.value("updated_at")))}</span>
                </Tooltip>
              </Descriptions.Item>
            </Descriptions>
          </Card>

          <Card
            size="small"
            title="Account"
            className="nu-block"
            data-testid="ticket-account"
            extra={
              customerId ? <Link to={`/customers/${customerId}`}>Open</Link> : undefined
            }
          >
            {!customerId ? (
              <EmptyState compact title="This ticket is not filed against a customer" />
            ) : account.isLoading ? (
              <Skeleton active title={false} paragraph={{ rows: 3 }} />
            ) : (
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="Customer">
                    {account.data?.title ?? "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Status">
                    {account.data ? <StatusTag status={account.data.status} /> : "—"}
                  </Descriptions.Item>
                </Descriptions>

                <div>
                  <Text strong className="nu-field-label">
                    Their other tickets
                  </Text>
                  {siblings.isLoading ? (
                    <Skeleton active title={false} paragraph={{ rows: 2 }} />
                  ) : others.length === 0 ? (
                    <Text type="secondary">This is the only one they have raised.</Text>
                  ) : (
                    <List
                      size="small"
                      dataSource={others}
                      renderItem={(row) => (
                        <List.Item>
                          <Space direction="vertical" size={0} style={{ width: "100%" }}>
                            <Link to={`/tickets/${row.id}`}>{row.subject}</Link>
                            <Space size={6}>
                              <StatusTag status={row.status} />
                              <Text type="secondary">{relativeTime(row.created_at)}</Text>
                            </Space>
                          </Space>
                        </List.Item>
                      )}
                    />
                  )}
                  {(siblings.data?.total ?? 0) > others.length + 1 && (
                    <Link to={`/tickets?f.customer_id=${customerId}`}>
                      All {siblings.data?.total} for this account
                    </Link>
                  )}
                </div>
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      {page.editing.drawer}
    </>
  );
}

const formatCount = (count: number) => (count === 1 ? "once" : `${count} times`);

/** `WAITING_CUSTOMER` → `Waiting customer`. An enum is not a sentence. */
function titleCase(value: string): string {
  if (!value) return "";
  const words = value.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * One moment in the handling of a ticket: when it happened, and how long after
 * the one before it.
 *
 * `reached` rather than a boolean called `done`: a deadline that has *passed*
 * has been reached and is not an achievement, and the sequence has to be able
 * to draw both.
 */
function Moment({
  label,
  at,
  note,
  reached,
  tone,
}: {
  label: string;
  at: string | null;
  note: string;
  reached: boolean;
  tone?: "danger";
}) {
  return (
    <li className={`nu-moment${reached ? " is-reached" : ""}`}>
      <span className="nu-moment-label">{label}</span>
      <span className="nu-moment-when">
        {at ? (
          <Tooltip title={absoluteTime(at)}>
            <Text type={tone}>{relativeTime(at)}</Text>
          </Tooltip>
        ) : (
          <Text type="secondary">—</Text>
        )}
      </span>
      <span className="nu-moment-note">
        <Text type={tone ?? "secondary"}>{note}</Text>
      </span>
    </li>
  );
}

/**
 * The clock, first, because it decides whether this is the next thing anybody
 * does: what the deadline is doing, in words, and how much of the window
 * between "raised" and "promised by" has gone.
 */
function SlaBanner({
  tone,
  headline,
  detail,
  severity,
  raised,
  due,
  resolved,
  reopened,
}: {
  tone: keyof typeof ALERT_TYPE;
  headline: string;
  detail: string;
  severity: string;
  raised: string | null;
  due: string | null;
  resolved: string | null;
  reopened: number;
}) {
  const start = parseInstant(raised)?.getTime() ?? null;
  const end = parseInstant(due)?.getTime() ?? null;
  const stop = parseInstant(resolved)?.getTime() ?? Date.now();
  const used =
    start !== null && end !== null && end > start
      ? Math.max(0, Math.min(1, (stop - start) / (end - start)))
      : null;
  return (
    <section
      className={`nx-rec-sla nx-rec-sla--${tone}`}
      data-testid="sla-standing"
      aria-label="Service level"
    >
      <span className="nx-rec-sla-icon" aria-hidden>
        <ClockCircleOutlined />
      </span>
      <div className="nx-rec-sla-text">
        <span className="nx-rec-sla-kicker">
          SLA{severity ? ` · ${humanStatus(severity)} severity` : ""}
        </span>
        <span className="nx-rec-sla-headline">{headline}</span>
        <span className="nx-rec-sla-detail">
          {detail}
          {reopened > 0 && <span className="nx-rec-sla-reopen">Reopened {formatCount(reopened)}</span>}
        </span>
      </div>
      {used !== null && (
        <div className="nx-rec-sla-window">
          <span className="nx-rec-sla-ends">
            <span>Raised {relativeTime(raised)}</span>
            <span>Promised {relativeTime(due)}</span>
          </span>
          <span
            className="nx-rec-sla-bar"
            role="img"
            aria-label={`${Math.round(used * 100)}% of the window used`}
          >
            <i style={{ width: `${used * 100}%` }} />
          </span>
          <span className="nx-rec-sla-used">{Math.round(used * 100)}% of the window used</span>
        </div>
      )}
    </section>
  );
}


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

import { Card, Col, Row, Space, Tag, Tooltip, Typography } from "antd";
import { useParams } from "react-router-dom";

import { useSmartBack } from "@/app/history";
import { AuditTimeline } from "@/components/audit/AuditTimeline";
import { CommentThread } from "@/components/comments/CommentThread";
import { RecordTimeCard, RecordTimerButton } from "@/components/decisions/RecordTimer";
import { TicketSlaCard, useTicketSla } from "@/components/decisions/TicketSlaCard";
import { PageHeader } from "@/components/PageHeader";
import { TagPicker } from "@/components/records/TagPicker";
import { useRecordPage } from "@/components/records/useRecordPage";
import { VersionHistoryButton } from "@/components/recordsAnalytics/VersionHistory";
import { StatusTag } from "@/components/StatusTag";
import { usePageCommands } from "@/commands/CommandContext";
import { ChoiceField, PersonField, RecordDeleteButton, RecordEditButton } from "@/entities/detail";
import { slaStanding } from "@/entities/sla";
import { asText } from "@/lib/text";
import { absoluteTime, relativeTime } from "@/lib/time";

import { AccountCard } from "./AccountCard";
import { FilingCard } from "./FilingCard";
import { HandlingCard } from "./HandlingCard";
import { SlaBanner } from "./SlaBanner";
import { useTicketAccount } from "./useTicketAccount";
import { titleCase } from "./words";

const { Text, Paragraph } = Typography;

export default function TicketConsolePage() {
  const { id = "" } = useParams();
  const back = useSmartBack();
  const page = useRecordPage("ticket", id, { listPath: "/tickets", noun: "ticket" });

  const customerId = asText(page.value("customer_id"));
  const { account, siblings } = useTicketAccount(customerId);

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

          <HandlingCard page={page} sla={sla} />

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
              <ChoiceField page={page} field="status" label="Status" value={ticket.status} loading={page.writing} />
              <ChoiceField page={page} field="severity" label="Severity" />
              <ChoiceField page={page} field="priority" label="Priority" />
              <PersonField page={page} field="assignee_id" label="Assignee" placeholder="Unassigned" />
            </Space>
          </Card>

          <FilingCard page={page} />

          <AccountCard id={id} customerId={customerId} account={account} siblings={siblings} />
        </Col>
      </Row>

      {page.editing.drawer}
    </>
  );
}

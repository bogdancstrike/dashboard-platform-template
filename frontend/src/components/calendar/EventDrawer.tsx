/**
 * An event, opened (§19, §36).
 *
 * A drawer rather than a route, for the reason the kanban card is one: an event
 * is read *against the week around it*. "What else is that afternoon" is half
 * of why it was opened, and a page would take the grid off screen.
 *
 * Three decisions worth stating.
 *
 * **Answering the invitation is the first control, and everybody gets it.**
 * Editing needs `calendar.manage` and being the organiser; saying whether you
 * are coming needs neither. It is also the only thing most readers ever do
 * here, so it is not behind an Edit button.
 *
 * **An edit changes the whole series, and the drawer says so before it is
 * used** — not after, in a toast. An editor that silently changed one
 * occurrence, or silently changed all of them, loses an afternoon either way.
 *
 * **A clash is named.** "Clashes with the Design review" is something a reader
 * can act on; "1 conflict" is a hunt through their own calendar.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Avatar,
  Button,
  Drawer,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { DeleteOutlined, EditOutlined } from "@ant-design/icons";

import {
  calendarApi,
  type CalendarOccurrence,
  type EventResponse,
} from "@/api/calendar";
import { ApiError } from "@/api/client";
import { AuditTimeline } from "@/components/audit/AuditTimeline";
import { CommentThread } from "@/components/comments/CommentThread";
import { clock } from "@/components/calendar/MonthGrid";
import { ResponseButtons } from "@/components/calendar/ResponseButtons";

const { Paragraph, Text, Title } = Typography;

const RESPONSE_LABEL: Record<EventResponse, string> = {
  NEEDS_ACTION: "no answer",
  ACCEPTED: "going",
  TENTATIVE: "maybe",
  DECLINED: "not going",
};

export function EventDrawer({
  occurrence,
  onClose,
  onChanged,
  onEdit,
}: {
  /** The occurrence the reader clicked, or null when the drawer is shut. */
  occurrence: CalendarOccurrence | null;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (occurrence: CalendarOccurrence) => void;
}) {
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();

  // Re-read from the server rather than trusting the grid's copy: a drawer
  // opened from a window fetched two minutes ago would show an answer somebody
  // has since changed.
  const event = useQuery({
    queryKey: ["calendar-event", occurrence?.event_id],
    queryFn: ({ signal }) => calendarApi.get(occurrence!.event_id, signal),
    enabled: Boolean(occurrence),
  });

  const detail = event.data;

  const answer = useMutation({
    mutationFn: (response: EventResponse) =>
      calendarApi.respond(occurrence!.event_id, response),
    onSuccess: (updated) => {
      queryClient.setQueryData(["calendar-event", occurrence?.event_id], updated);
      onChanged();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That answer was refused."),
  });

  const cancel = useMutation({
    mutationFn: () => calendarApi.remove(occurrence!.event_id),
    onSuccess: () => {
      message.success("Event cancelled");
      onChanged();
      onClose();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That could not be cancelled."),
  });

  return (
    <Drawer
      open={occurrence !== null}
      width={560}
      onClose={onClose}
      title={
        detail ? (
          <Space size={8}>
            <Tag color={detail.status === "CANCELLED" ? "error" : undefined} bordered={false}>
              {detail.category.toLowerCase()}
            </Tag>
            {detail.status === "CANCELLED" && <Text type="danger">cancelled</Text>}
          </Space>
        ) : (
          "Event"
        )
      }
      extra={
        detail?.can_edit && occurrence ? (
          <Space size={8}>
            <Button
              icon={<EditOutlined />}
              onClick={() => onEdit(occurrence)}
              data-testid="edit-event"
            >
              Edit
            </Button>
            <Button
              danger
              icon={<DeleteOutlined />}
              loading={cancel.isPending}
              onClick={() =>
                modal.confirm({
                  title: `Cancel ${detail.title}?`,
                  content: detail.recurrence
                    ? "Every occurrence of this repeat is cancelled. The record is kept, and anybody invited keeps their answer in the history."
                    : "The record is kept for the history, and anybody invited will see that it is not happening.",
                  okText: "Cancel the event",
                  okButtonProps: { danger: true },
                  onOk: () => cancel.mutateAsync(),
                })
              }
              data-testid="cancel-event"
            >
              Cancel
            </Button>
          </Space>
        ) : undefined
      }
    >
      {event.isLoading || !detail || !occurrence ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <Space direction="vertical" size={16} className="nu-block">
          <div>
            <Title level={4} className="nu-event-title">
              {detail.title}
            </Title>
            <Text type="secondary">
              {occurrence.all_day
                ? "All day"
                : `${clock(occurrence.starts_at)} – ${clock(occurrence.ends_at)} · ${occurrence.minutes} min`}
              {detail.location ? ` · ${detail.location}` : ""}
            </Text>
          </div>

          {/* Said before an edit is attempted, not after it lands (§76). */}
          {detail.recurrence && (
            <Alert
              type="info"
              showIcon
              message={`Repeats ${detail.recurrence_text}`}
              description="Editing changes every occurrence, not only this one."
            />
          )}

          {occurrence.clashes_with.length > 0 && (
            <Alert
              type="warning"
              showIcon
              data-testid="event-clash"
              message="This overlaps something else you are in"
              description={`Clashes with ${occurrence.clashes_with.join(", ")}.`}
            />
          )}

          {/* The first control, and the one most readers came for. Needs no
              permission beyond being invited. */}
          {detail.involves_me && detail.status !== "CANCELLED" && (
            <div>
              <Text strong className="nu-field-label">
                Are you going?
              </Text>
              <div data-testid="my-response">
                <ResponseButtons
                  size="middle"
                  label="Your answer"
                  value={detail.my_response}
                  onChange={(response) => answer.mutate(response)}
                  disabled={answer.isPending}
                />
              </div>
              {detail.my_response === "NEEDS_ACTION" && (
                <Text type="secondary">You have not answered yet.</Text>
              )}
            </div>
          )}

          {detail.description && (
            <div>
              <Text strong className="nu-field-label">
                What it is about
              </Text>
              <Paragraph className="nu-event-body">{detail.description}</Paragraph>
            </div>
          )}

          <div>
            <Text strong className="nu-field-label">
              Who is coming{" "}
              <Text type="secondary">
                {detail.participants.filter((item) => item.response === "ACCEPTED").length} of{" "}
                {detail.participants.length}
              </Text>
            </Text>
            <Space direction="vertical" size={4} className="nu-block">
              {detail.participants.length === 0 && (
                <Text type="secondary">Nobody was invited.</Text>
              )}
              {detail.participants.map((person) => (
                <div key={person.user_id} className="nu-attendee">
                  <Space size={8}>
                    <Avatar size="small">{person.initials}</Avatar>
                    <Text>{person.name ?? person.email ?? "Somebody"}</Text>
                    {detail.organizer.id === person.user_id && (
                      <Tag bordered={false}>organiser</Tag>
                    )}
                  </Space>
                  {/* In words, never a colour: "no answer" and "not going" are
                      different facts and a grey dot says neither (§64). */}
                  <Text type={person.response === "DECLINED" ? "danger" : "secondary"}>
                    {RESPONSE_LABEL[person.response]}
                  </Text>
                </div>
              ))}
            </Space>
          </div>

          {detail.reminder_minutes !== null && (
            <Text type="secondary">
              Reminds everybody {detail.reminder_minutes} minutes before.
            </Text>
          )}

          <div>
            <Text strong className="nu-field-label">
              Conversation
            </Text>
            <CommentThread resourceType="calendar_event" resourceId={detail.event_id} />
          </div>

          <div>
            <Text strong className="nu-field-label">
              History
            </Text>
            <AuditTimeline
              resourceType="calendar_event"
              resourceId={detail.event_id}
              limit={8}
            />
          </div>

          <Text type="secondary">
            Organised by{" "}
            <Tooltip title={detail.organizer.name ?? ""}>
              <span>{detail.organizer.name ?? "somebody who has since left"}</span>
            </Tooltip>
          </Text>
        </Space>
      )}
    </Drawer>
  );
}

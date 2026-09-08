/**
 * A card, opened (§18, §36).
 *
 * A drawer rather than a route, because a card is read *against the board*: a
 * page would take the columns off screen, and the question "what else is in
 * this lane" is half of why the card was opened. The board stays behind it,
 * and closing puts the reader back where they were with no navigation.
 *
 * Three decisions worth stating.
 *
 * **The controls used every day write on change.** Lane, priority, assignee
 * and points are selects that save when they change — the same
 * optimistic-then-reconciled path the drag uses (§73). Everything rarer is a
 * field somebody edits and saves. A card that needed a form opened to change
 * its priority is a card whose priority stays wrong.
 *
 * **The family is shown, and the parent is a control.** A story says which
 * epic it belongs to and what hangs off it, and the parent picker offers only
 * what the server's hierarchy rule permits — so it cannot offer a pairing the
 * write would refuse (§76).
 *
 * **The conversation and the history are the same components every record
 * page uses.** A second comment thread for boards would be a second set of
 * rules about who may say what.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  App as AntApp,
  Button,
  Checkbox,
  Drawer,
  Input,
  Select,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { kanbanApi, type CardInput } from "@/api/kanban";
import { AuditTimeline } from "@/components/audit/AuditTimeline";
import { CommentThread } from "@/components/comments/CommentThread";
import { PeoplePicker } from "@/components/PeoplePicker";
import { KIND_LABELS } from "@/components/kanban/KanbanCardTile";
import { absoluteTime, relativeTime } from "@/lib/time";

const { Text, Title } = Typography;

export function CardDrawer({
  cardId,
  /**
   * The priorities the board published. Passed in rather than listed here:
   * `core/vocabulary.PRIORITY` is the one place, and a drawer offering a fifth
   * value the record endpoint refuses is a drawer that fails on save.
   */
  priorities,
  onClose,
  onChanged,
}: {
  cardId: string | null;
  priorities: string[];
  onClose: () => void;
  /** The board behind the drawer has to hear about every write. */
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const [step, setStep] = useState("");

  const card = useQuery({
    queryKey: ["kanban-card", cardId],
    queryFn: ({ signal }) => kanbanApi.card(cardId!, signal),
    enabled: Boolean(cardId),
  });

  const detail = card.data;
  const canEdit = detail?.can_edit ?? false;

  const write = useMutation({
    mutationFn: (input: CardInput) => kanbanApi.updateCard(cardId!, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["kanban-card", cardId], (current: typeof detail) =>
        current ? { ...current, ...updated } : current,
      );
      onChanged();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That change was refused."),
  });

  const relocate = useMutation({
    mutationFn: (laneId: string) => kanbanApi.moveCard(cardId!, laneId, 0),
    onSuccess: () => {
      void card.refetch();
      onChanged();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That move was refused."),
  });

  const remove = useMutation({
    mutationFn: () => kanbanApi.removeCard(cardId!),
    onSuccess: (answer) => {
      message.success(
        answer.reparented > 0
          ? `Deleted — ${answer.reparented} card${answer.reparented === 1 ? "" : "s"} moved up a level`
          : "Card deleted",
      );
      onChanged();
      onClose();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That could not be deleted."),
  });

  /** Tick a to-do. It is a field on the card, audited with every other edit. */
  const tick = (index: number, done: boolean) => {
    if (!detail) return;
    write.mutate({
      checklist: detail.checklist.map((item, position) =>
        position === index ? { ...item, done } : item,
      ),
    });
  };

  const addStep = () => {
    const text = step.trim();
    if (!text || !detail) return;
    write.mutate({ checklist: [...detail.checklist, { text, done: false }] });
    setStep("");
  };

  return (
    <Drawer
      open={cardId !== null}
      width={620}
      onClose={onClose}
      title={
        detail ? (
          <Space size={8}>
            <Tag bordered={false}>{KIND_LABELS[detail.kind]}</Tag>
            <Text className="nu-mono">{detail.reference}</Text>
          </Space>
        ) : (
          "Card"
        )
      }
      extra={
        detail && canEdit ? (
          <Button
            danger
            icon={<DeleteOutlined />}
            loading={remove.isPending}
            onClick={() =>
              modal.confirm({
                title: `Delete ${detail.reference}?`,
                content:
                  detail.children.length > 0
                    ? `${detail.children.length} card${detail.children.length === 1 ? "" : "s"} hang off it — they move up a level rather than being deleted.`
                    : "The audit trail keeps what it was.",
                okText: "Delete",
                okButtonProps: { danger: true },
                onOk: () => remove.mutateAsync(),
              })
            }
            data-testid="delete-card"
          >
            Delete
          </Button>
        ) : undefined
      }
    >
      {card.isLoading || !detail ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          {/* The title is editable in place: a card whose name is wrong is
              the commonest thing anybody fixes. */}
          <Title level={4} className="nu-card-drawer-title">
            {canEdit ? (
              <Input.TextArea
                autoSize
                defaultValue={detail.title}
                aria-label="Title"
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value && value !== detail.title) write.mutate({ title: value });
                }}
              />
            ) : (
              detail.title
            )}
          </Title>

          {/* Written on change, like the task page's triage controls — the
              same path the drag uses (§73). */}
          <div className="nu-card-drawer-grid">
            <Field label="Lane">
              <Select
                aria-label="Lane"
                style={{ width: "100%" }}
                value={detail.lane_id ?? undefined}
                disabled={!canEdit}
                loading={relocate.isPending}
                onChange={(next: string) => relocate.mutate(next)}
                options={detail.lanes.map((lane) => ({
                  value: lane.id,
                  label: lane.is_done ? `${lane.name} · done` : lane.name,
                }))}
              />
            </Field>

            <Field label="Priority">
              <Select
                aria-label="Priority"
                style={{ width: "100%" }}
                value={detail.priority}
                disabled={!canEdit}
                onChange={(next: string) => write.mutate({ priority: next })}
                options={priorities.map((item) => ({
                  value: item,
                  label: item.charAt(0) + item.slice(1).toLowerCase(),
                }))}
              />
            </Field>

            <Field label="Assignee">
              <PeoplePicker
                multiple={false}
                aria-label="Assignee"
                placeholder="Unassigned"
                disabled={!canEdit}
                value={detail.assignee.id ? [detail.assignee.id] : []}
                onChange={(ids) => write.mutate({ assignee_id: ids[0] ?? null })}
              />
            </Field>

            <Field label="Points">
              <Select
                aria-label="Points"
                style={{ width: "100%" }}
                allowClear
                placeholder="Not estimated"
                value={detail.story_points ?? undefined}
                disabled={!canEdit}
                onChange={(next: number | undefined) =>
                  write.mutate({ story_points: next ?? null })
                }
                options={[1, 2, 3, 5, 8, 13, 21].map((item) => ({
                  value: item,
                  label: String(item),
                }))}
              />
            </Field>

            {/* Only offered when the hierarchy permits one — the options come
                from the server's own rule (§76). */}
            {detail.parent_options.length > 0 && (
              <Field label={detail.kind === "STORY" ? "Epic" : "Story"}>
                <Select
                  aria-label="Parent"
                  style={{ width: "100%" }}
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="Not under anything"
                  value={detail.parent_id ?? undefined}
                  disabled={!canEdit}
                  onChange={(next: string | undefined) =>
                    write.mutate({ parent_id: next ?? null })
                  }
                  options={detail.parent_options.map((option) => ({
                    value: option.id,
                    label: `${option.reference} ${option.title}`,
                  }))}
                />
              </Field>
            )}

            <Field label="Labels">
              <Select
                mode="tags"
                aria-label="Labels"
                style={{ width: "100%" }}
                placeholder="None"
                value={detail.labels}
                disabled={!canEdit}
                onChange={(next: string[]) => write.mutate({ labels: next })}
              />
            </Field>
          </div>

          <div>
            <Text strong className="nu-field-label">
              What needs doing
            </Text>
            {canEdit ? (
              <Input.TextArea
                rows={4}
                defaultValue={detail.description ?? ""}
                aria-label="What needs doing"
                placeholder="Context, acceptance criteria, and what would make this wrong."
                onBlur={(event) => {
                  const value = event.target.value;
                  if (value !== (detail.description ?? "")) write.mutate({ description: value });
                }}
              />
            ) : (
              <Text>{detail.description || "No description was given."}</Text>
            )}
          </div>

          {/* The family, because "what is this part of" is half of why a card
              gets opened. */}
          {(detail.parent || detail.children.length > 0) && (
            <div data-testid="card-family">
              <Text strong className="nu-field-label">
                Where this sits
              </Text>
              <Space direction="vertical" size={4} style={{ width: "100%" }}>
                {detail.parent && (
                  <Text type="secondary">
                    Part of <Text className="nu-mono">{detail.parent.reference}</Text>{" "}
                    {detail.parent.title}
                  </Text>
                )}
                {detail.children.map((child) => (
                  <Text key={child.id} type="secondary">
                    Holds <Text className="nu-mono">{child.reference}</Text> {child.title}
                  </Text>
                ))}
              </Space>
            </div>
          )}

          {/* A checklist is a field on the card, audited with every other
              edit — a "checklist API" would be a second set of rules about
              who may tick a box. */}
          <div data-testid="card-checklist">
            <Text strong className="nu-field-label">
              Checklist{" "}
              {detail.checklist.length > 0 && (
                <Text type="secondary">
                  {detail.checklist_done} of {detail.checklist.length}
                </Text>
              )}
            </Text>
            <Space direction="vertical" size={4} style={{ width: "100%" }}>
              {detail.checklist.map((item, index) => (
                <Checkbox
                  key={`${item.text}-${index}`}
                  checked={item.done}
                  disabled={!canEdit || write.isPending}
                  onChange={(event) => tick(index, event.target.checked)}
                >
                  {item.text}
                </Checkbox>
              ))}
              {canEdit && (
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    value={step}
                    placeholder="Add a step"
                    aria-label="New checklist item"
                    onChange={(event) => setStep(event.target.value)}
                    onPressEnter={addStep}
                  />
                  <Button icon={<PlusOutlined />} onClick={addStep}>
                    Add
                  </Button>
                </Space.Compact>
              )}
            </Space>
          </div>

          <div>
            <Text strong className="nu-field-label">
              Conversation
            </Text>
            <CommentThread resourceType="kanban_card" resourceId={detail.id} />
          </div>

          <div>
            <Text strong className="nu-field-label">
              History
            </Text>
            <AuditTimeline resourceType="kanban_card" resourceId={detail.id} limit={8} />
          </div>

          <Text type="secondary">
            Created {relativeTime(detail.created_at)}
            {detail.completed_at ? (
              <Tooltip title={absoluteTime(detail.completed_at)}>
                <span> · finished {relativeTime(detail.completed_at)}</span>
              </Tooltip>
            ) : null}
          </Text>
        </Space>
      )}
    </Drawer>
  );
}

/** A labelled control, so the drawer reads as a card being described. */
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

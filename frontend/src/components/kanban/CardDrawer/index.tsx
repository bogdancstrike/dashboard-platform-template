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

import { App as AntApp, Button, Drawer, Input, Skeleton, Space, Tag, Tooltip, Typography } from "antd";
import { DeleteOutlined } from "@ant-design/icons";

import { AuditTimeline } from "@/components/audit/AuditTimeline";
import { CommentThread } from "@/components/comments/CommentThread";
import { KIND_LABELS } from "@/components/kanban/KanbanCardTile";
import { absoluteTime, relativeTime } from "@/lib/time";
import { URL_OVERLAY } from "@/app/history";

import { CardChecklist } from "./CardChecklist";
import { CardFields } from "./CardFields";
import { useCardDrawer } from "./useCardDrawer";

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
  const model = useCardDrawer(cardId, onChanged, onClose);
  const { modal } = AntApp.useApp();
  const { card, detail, canEdit, write, remove } = model;

  return (
    <Drawer
      // Its state is in the address (pushed), so the router owns back for it.
      rootClassName={URL_OVERLAY}
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
          <CardFields model={model} priorities={priorities} />

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
          <CardChecklist model={model} />

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

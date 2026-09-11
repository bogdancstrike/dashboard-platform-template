/**
 * `/tasks/:id` — a work page, not a field dump (§8, §18, §36, §48).
 *
 * The generic detail page renders whatever a resource declares, which is the
 * right default for six datasets and the wrong one for the dataset people
 * actually work *in*. A task is the thing somebody has open while they do the
 * work, so this page is shaped like that job rather than like the table it
 * came from: what has to be done down the middle, who and when down the side,
 * the conversation underneath, and the history beneath that.
 *
 * Three decisions worth stating.
 *
 * **The controls that get used every day do not open a form.** Status,
 * priority and assignee write on change, through the same endpoint and the
 * same optimistic-then-reconciled path the board's drag uses (§73). Everything
 * rarer is behind Edit, which is the declaration-driven drawer every entity
 * shares — so this page adds a *shape*, not a second way to write a task.
 *
 * **Ticking a to-do is an edit to the record.** The checklist is a declared
 * field, written by the record endpoint, audited like any other change. A
 * separate "checklist API" would be a second set of rules about who may change
 * what, for the same row.
 *
 * **The conversation and the history are different things.** Comments are what
 * people said; the audit timeline is what the system recorded. Showing them as
 * one feed makes it impossible to tell a decision from a side effect.
 *
 * Loading the record, saying why it will not open, and writing one field with
 * the version it was read at are `useRecordPage`'s: the delivery review and
 * the support console answer those three questions too, and they have to
 * answer them identically.
 */

import {
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Input,
  Progress,
  Row,
  Select,
  Space,
  Tooltip,
  Typography,
} from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { AuditTimeline } from "@/components/audit/AuditTimeline";
import { CommentThread } from "@/components/comments/CommentThread";
import { PageHeader } from "@/components/PageHeader";
import { TagPicker } from "@/components/records/TagPicker";
import { PeoplePicker } from "@/components/PeoplePicker";
import { useRecordPage } from "@/components/records/useRecordPage";
import { StatusTag } from "@/components/StatusTag";
import { usePageCommands } from "@/commands/CommandContext";
import { absoluteTime, relativeTime } from "@/lib/time";
import { asText } from "@/lib/text";

const { Text, Paragraph } = Typography;

/** One line of the card's to-do list, as the record stores it. */
interface ChecklistItem {
  text: string;
  done: boolean;
}

export default function TaskDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [newItem, setNewItem] = useState("");
  const page = useRecordPage("task", id, { listPath: "/tasks", noun: "task" });

  usePageCommands("record:task", [
    {
      id: "task.edit",
      label: "Edit this task",
      keywords: "change update",
      run: () => page.editing.edit(id),
    },
    {
      id: "task.done",
      label: "Mark this task done",
      keywords: "complete finish status",
      run: () => page.write({ status: "DONE" }),
    },
    {
      id: "task.copy-link",
      label: "Copy a link to this task",
      keywords: "share url",
      run: () => void navigator.clipboard.writeText(window.location.href),
    },
  ]);

  if (page.fallback) return page.fallback;

  const task = page.record!;
  const checklist = (page.value("checklist") as ChecklistItem[] | null) ?? [];
  const done = checklist.filter((item) => item.done).length;

  const writeChecklist = (items: ChecklistItem[]) => page.write({ checklist: items });

  return (
    <>
      <PageHeader
        title={task.title}
        onBack={() => navigate("/tasks")}
        subtitle={
          <Space size={8} wrap>
            <Text type="secondary" className="nu-mono">
              {task.subtitle}
            </Text>
            <Text type="secondary">
              Updated{" "}
              <Tooltip title={absoluteTime(task.updated_at)}>
                <span>{relativeTime(task.updated_at)}</span>
              </Tooltip>
            </Text>
          </Space>
        }
        tag={<StatusTag status={task.status} data-testid="record-status" />}
        actions={
          <>
            <Tooltip title={task.can_edit ? "" : "Your role does not include records.update"}>
              <Button
                type="primary"
                icon={<EditOutlined />}
                disabled={!task.can_edit}
                onClick={() => page.editing.edit(id)}
                data-testid="record-edit"
              >
                Edit
              </Button>
            </Tooltip>
            <Tooltip title={task.can_delete ? "" : "Your role does not include records.delete"}>
              <Button
                danger
                icon={<DeleteOutlined />}
                disabled={!task.can_delete}
                onClick={() => page.editing.remove(id, task.title)}
              >
                Delete
              </Button>
            </Tooltip>
          </>
        }
      />

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={16}>
          <TagPicker resourceType="task" recordId={id} listPath="/tasks" />
          <Card size="small" title="Description" className="nu-block">
            <Paragraph className="nu-record-prose">
              {asText(page.value("description")) || "No description was given."}
            </Paragraph>
          </Card>

          <Card
            size="small"
            className="nu-block"
            title={
              <Space size={8}>
                <span>Checklist</span>
                {checklist.length > 0 && (
                  <Text type="secondary" data-testid="checklist-progress">
                    {done} of {checklist.length}
                  </Text>
                )}
              </Space>
            }
            data-testid="task-checklist"
          >
            {checklist.length > 0 && (
              <Progress
                aria-label={`Checklist: ${done} of ${checklist.length} done`}
                className="nu-block nu-gauge"
                percent={Math.round((done / checklist.length) * 100)}
                size="small"
              />
            )}
            <ul className="nu-checklist">
              {checklist.map((item, index) => (
                <li key={`${item.text}-${index}`}>
                  <Checkbox
                    checked={item.done}
                    disabled={!task.can_edit || page.writing}
                    onChange={(event) =>
                      writeChecklist(
                        checklist.map((entry, position) =>
                          position === index ? { ...entry, done: event.target.checked } : entry,
                        ),
                      )
                    }
                  >
                    <span className={item.done ? "nu-checklist-done" : undefined}>{item.text}</span>
                  </Checkbox>
                  {task.can_edit && (
                    <Button
                      type="text"
                      aria-label={`Remove ${item.text}`}
                      icon={<DeleteOutlined />}
                      onClick={() =>
                        writeChecklist(checklist.filter((_entry, position) => position !== index))
                      }
                    />
                  )}
                </li>
              ))}
            </ul>

            {task.can_edit && (
              <Space.Compact style={{ width: "100%" }}>
                <Input
                  aria-label="New checklist item"
                  placeholder="Add a step"
                  value={newItem}
                  onChange={(event) => setNewItem(event.target.value)}
                  onPressEnter={() => {
                    if (!newItem.trim()) return;
                    writeChecklist([...checklist, { text: newItem.trim(), done: false }]);
                    setNewItem("");
                  }}
                />
                <Button
                  icon={<PlusOutlined />}
                  disabled={!newItem.trim()}
                  onClick={() => {
                    writeChecklist([...checklist, { text: newItem.trim(), done: false }]);
                    setNewItem("");
                  }}
                >
                  Add
                </Button>
              </Space.Compact>
            )}
          </Card>

          <Card size="small" title="Comments" className="nu-block">
            <CommentThread resourceType="task" resourceId={id} />
          </Card>

          <Card size="small" title="History" className="nu-block">
            {/* What the system recorded, kept apart from what people said:
                one feed makes a decision indistinguishable from a side
                effect (§21, §48). */}
            <AuditTimeline resourceType="task" resourceId={id} limit={8} />
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card size="small" title="Details" data-testid="task-side">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Field label="Status">
                <Select
                  aria-label="Status"
                  style={{ width: "100%" }}
                  value={task.status}
                  disabled={!task.can_edit}
                  loading={page.writing}
                  onChange={(next) => page.write({ status: next })}
                  options={page.choices("status").map((choice) => ({
                    value: choice,
                    label: choice.replace(/_/g, " "),
                  }))}
                />
              </Field>

              <Field label="Priority">
                <Select
                  aria-label="Priority"
                  style={{ width: "100%" }}
                  value={asText(page.value("priority"))}
                  disabled={!task.can_edit}
                  onChange={(next) => page.write({ priority: next })}
                  options={page.choices("priority").map((choice) => ({ value: choice, label: choice }))}
                />
              </Field>

              <Field label="Assignee">
                <PeoplePicker
                  multiple={false}
                  aria-label="Assignee"
                  placeholder="Nobody yet"
                  disabled={!task.can_edit}
                  value={page.value("assignee_id") ? [asText(page.value("assignee_id"))] : []}
                  onChange={(ids) => page.write({ assignee_id: ids[0] ?? null })}
                />
              </Field>

              <Field label="Progress">
                <Progress
                  aria-label={`Progress: ${Number(page.value("progress") ?? 0)}%`}
                  className="nu-gauge"
                  percent={Number(page.value("progress") ?? 0)}
                  size="small"
                />
              </Field>

              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="Kind">{asText(page.value("kind")) || "—"}</Descriptions.Item>
                <Descriptions.Item label="Due">
                  {page.value("due_date") ? absoluteTime(asText(page.value("due_date"))) : "—"}
                </Descriptions.Item>
                <Descriptions.Item label="Effort">
                  {Math.round(Number(page.value("logged_hours") ?? 0))} of{" "}
                  {Math.round(Number(page.value("estimate_hours") ?? 0))} h
                </Descriptions.Item>
                <Descriptions.Item label="Created">
                  {absoluteTime(task.created_at)}
                </Descriptions.Item>
              </Descriptions>
            </Space>
          </Card>
        </Col>
      </Row>

      {page.editing.drawer}
    </>
  );
}

/** A labelled control in the side panel. */
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

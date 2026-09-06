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
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Input,
  Progress,
  Row,
  Select,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { explorerApi } from "@/api/explorer";
import { recordsApi } from "@/api/records";
import { AuditTimeline } from "@/components/audit/AuditTimeline";
import { CommentThread } from "@/components/comments/CommentThread";
import { PageHeader } from "@/components/PageHeader";
import { PeoplePicker } from "@/components/PeoplePicker";
import { useRecordEditing } from "@/components/records/useRecordEditing";
import { usePageCommands } from "@/commands/CommandContext";
import { absoluteTime, relativeTime } from "@/lib/time";
import { asText } from "@/lib/text";
import { knownStatusColor } from "@/theme/tokens";

const { Text, Paragraph } = Typography;

/** One line of the card's to-do list, as the record stores it. */
interface ChecklistItem {
  text: string;
  done: boolean;
}

export default function TaskDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [newItem, setNewItem] = useState("");

  const record = useQuery({
    queryKey: ["record", "task", id],
    queryFn: ({ signal }) => recordsApi.get("task", id, signal),
    enabled: Boolean(id),
  });

  // The vocabularies the quick controls offer. Read from the catalogue rather
  // than hard-coded, so a status added to the domain appears here too.
  const catalogue = useQuery({
    queryKey: ["explorer-catalogue"],
    queryFn: ({ signal }) => explorerApi.catalogue(signal),
    staleTime: 60_000,
  });
  const resource = catalogue.data?.items.find((item) => item.key === "task");

  const records = useRecordEditing(resource, { onDeleted: () => navigate("/tasks") });

  /**
   * A field written from the page rather than from the drawer.
   *
   * Sends the version it read, so an edit written against a task somebody else
   * has moved is refused rather than silently applied over theirs (§73).
   */
  const patch = useMutation({
    mutationFn: (changes: Record<string, unknown>) =>
      recordsApi.update("task", id, {
        ...changes,
        expected_updated_at: record.data?.updated_at ?? null,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(["record", "task", id], saved);
      void queryClient.invalidateQueries({ queryKey: ["task-lane"] });
      void queryClient.invalidateQueries({ queryKey: ["entity-rows"] });
    },
    onError: (error) => {
      const stale = error instanceof ApiError && error.status === 409;
      message.error(
        stale
          ? "Somebody else changed this task while you had it open — reloading it."
          : error instanceof ApiError
            ? error.message
            : "That change was not saved.",
      );
      if (stale) void record.refetch();
    },
  });

  usePageCommands("record:task", [
    { id: "task.edit", label: "Edit this task", keywords: "change update", run: () => records.edit(id) },
    {
      id: "task.done",
      label: "Mark this task done",
      keywords: "complete finish status",
      run: () => patch.mutate({ status: "DONE" }),
    },
    {
      id: "task.copy-link",
      label: "Copy a link to this task",
      keywords: "share url",
      run: () => void navigator.clipboard.writeText(window.location.href),
    },
  ]);

  if (record.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (record.isError) {
    const error = record.error;
    const missing = error instanceof ApiError && error.isNotFound;
    return (
      <>
        <PageHeader
          title={missing ? "Task not found" : "Could not open this task"}
          onBack={() => navigate("/tasks")}
        />
        <Alert
          type={missing ? "warning" : "error"}
          showIcon
          message={
            missing
              ? "It may have been deleted, or the link may be wrong."
              : error instanceof ApiError
                ? error.message
                : "The request failed."
          }
          description={
            error instanceof ApiError ? (
              <Text code copyable={{ text: error.correlationId }}>
                {error.correlationId}
              </Text>
            ) : undefined
          }
          action={
            <Button size="small" onClick={() => void record.refetch()}>
              Retry
            </Button>
          }
        />
      </>
    );
  }

  const task = record.data!;
  const value = (name: string) => task.fields.find((field) => field.name === name)?.value;
  const checklist = (value("checklist") as ChecklistItem[] | null) ?? [];
  const done = checklist.filter((item) => item.done).length;
  const choices = (name: string) =>
    resource?.fields.find((field) => field.name === name)?.choices ?? [];

  const writeChecklist = (items: ChecklistItem[]) => patch.mutate({ checklist: items });

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
        tag={
          <Tag color={knownStatusColor(task.status)} data-testid="record-status">
            {task.status}
          </Tag>
        }
        actions={
          <>
            <Tooltip title={task.can_edit ? "" : "Your role does not include records.update"}>
              <Button
                type="primary"
                icon={<EditOutlined />}
                disabled={!task.can_edit}
                onClick={() => records.edit(id)}
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
                onClick={() => records.remove(id, task.title)}
              >
                Delete
              </Button>
            </Tooltip>
          </>
        }
      />

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={16}>
          <Card size="small" title="Description" className="nu-block">
            <Paragraph className="nu-record-prose">
              {asText(value("description")) || "No description was given."}
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
                percent={Math.round((done / checklist.length) * 100)}
                size="small"
                className="nu-block"
              />
            )}
            <ul className="nu-checklist">
              {checklist.map((item, index) => (
                <li key={`${item.text}-${index}`}>
                  <Checkbox
                    checked={item.done}
                    disabled={!task.can_edit || patch.isPending}
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
                      size="small"
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
                  loading={patch.isPending}
                  onChange={(next) => patch.mutate({ status: next })}
                  options={choices("status").map((choice) => ({
                    value: choice,
                    label: choice.replace(/_/g, " "),
                  }))}
                />
              </Field>

              <Field label="Priority">
                <Select
                  aria-label="Priority"
                  style={{ width: "100%" }}
                  value={asText(value("priority"))}
                  disabled={!task.can_edit}
                  onChange={(next) => patch.mutate({ priority: next })}
                  options={choices("priority").map((choice) => ({ value: choice, label: choice }))}
                />
              </Field>

              <Field label="Assignee">
                <PeoplePicker
                  multiple={false}
                  aria-label="Assignee"
                  placeholder="Nobody yet"
                  disabled={!task.can_edit}
                  value={value("assignee_id") ? [asText(value("assignee_id"))] : []}
                  onChange={(ids) => patch.mutate({ assignee_id: ids[0] ?? null })}
                />
              </Field>

              <Field label="Progress">
                <Progress percent={Number(value("progress") ?? 0)} size="small" />
              </Field>

              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="Kind">{asText(value("kind")) || "—"}</Descriptions.Item>
                <Descriptions.Item label="Due">
                  {value("due_date") ? absoluteTime(asText(value("due_date"))) : "—"}
                </Descriptions.Item>
                <Descriptions.Item label="Effort">
                  {Math.round(Number(value("logged_hours") ?? 0))} of{" "}
                  {Math.round(Number(value("estimate_hours") ?? 0))} h
                </Descriptions.Item>
                <Descriptions.Item label="Created">
                  {absoluteTime(task.created_at)}
                </Descriptions.Item>
              </Descriptions>
            </Space>
          </Card>
        </Col>
      </Row>

      {records.drawer}
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

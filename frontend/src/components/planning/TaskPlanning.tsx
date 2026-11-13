/**
 * A task page's place in the plan (§18): points, dates, epic, sprint, flag,
 * cover, watchers and recurrence down the side; subtasks and dependencies in
 * the middle; a checklist that can be reordered by dragging.
 *
 * Fields that belong to the record (points, start date, epic, milestone,
 * cover, blocked reason) are written through the record page's own `write`,
 * so they are audited and version-checked exactly as Status and Priority are.
 * Things that are not fields of the row — which sprint, who watches, how it
 * recurs, what it waits on — go through the planning API.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  App as AntApp,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { DeleteOutlined, HolderOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { planningApi, type PlanBrief, type Recurrence, type TaskPlanning as Planning } from "@/api/planning";
import { recordsApi } from "@/api/records";
import { StatusTag } from "@/components/StatusTag";
import { DropGap, useBoardDrag } from "@/components/kanban/useBoardDrag";
import type { RecordPage } from "@/components/records/useRecordPage";
import { asText } from "@/lib/text";
import { refreshRecordViews } from "@/lib/refresh";
import { relativeTime } from "@/lib/time";

import { KindBadge, Points } from "./PlanItem";
import { PlanIcon } from "./planIcons";
import { shortDate } from "./gantt";

// Stored on the task as `cover_color` and seeded with these exact strings, so
// they are data the server keeps rather than styling. palette-exempt
export const COVERS = ["#2457D6", "#7c3aed", "#0891b2", "#16a34a", "#ca8a04", "#dc2626", "#db2777", "#64748b"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function useTaskPlanning(id: string) {
  return useQuery({
    queryKey: ["task-planning", id],
    queryFn: ({ signal }) => planningApi.planning(id, signal),
    enabled: Boolean(id),
  });
}

function useRefresh(id: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["task-planning", id] });
    refreshRecordViews(queryClient);
  };
}

function failure(error: unknown) {
  return error instanceof ApiError ? error.message : "That could not be saved.";
}

/** The side card: points, start, epic, sprint, milestone, flag, cover, watchers, repeat. */
export function TaskPlanningSide({ id, page }: { id: string; page: RecordPage }) {
  const { message } = AntApp.useApp();
  const planning = useTaskPlanning(id);
  const refresh = useRefresh(id);
  const canEdit = Boolean(page.record?.can_edit);
  const [repeating, setRepeating] = useState(false);
  const projectId = asText(page.value("project_id"));
  const epics = useQuery({
    queryKey: ["epics", projectId],
    queryFn: ({ signal }) => planningApi.epics({ project_id: projectId || undefined }, signal),
  });
  const sprints = useQuery({
    queryKey: ["sprints", projectId],
    queryFn: ({ signal }) => planningApi.sprints({ project_id: projectId || undefined }, signal),
  });

  const watch = useMutation({
    mutationFn: (on: boolean) => (on ? planningApi.watch(id) : planningApi.unwatch(id)),
    onSuccess: (result) => message.success(result.watching ? "You will hear about changes to this task" : "No longer watching"),
    onError: (error) => message.error(failure(error)),
    onSettled: refresh,
  });
  const plan = useMutation({
    mutationFn: (sprintId: string | null) => planningApi.place({ task_id: id, sprint_id: sprintId, after_id: null, before_id: null }),
    onSuccess: () => message.success("Sprint updated"),
    onError: (error) => message.error(failure(error)),
    onSettled: refresh,
  });

  const data = planning.data;
  const blocked = asText(page.value("blocked_reason"));
  const cover = asText(page.value("cover_color"));
  const isEpic = asText(page.value("kind")) === "EPIC";

  return (
    <Card size="small" title="Planning" className="nu-block" data-testid="task-planning">
      <div className="nx-pl-facts">
        <div>
          <label htmlFor="task-points">Story points</label>
          <InputNumber
            id="task-points"
            aria-label="Story points"
            min={0}
            max={999}
            style={{ width: "100%" }}
            disabled={!canEdit}
            defaultValue={(page.value("story_points") as number | null) ?? undefined}
            key={`points-${String(page.value("story_points"))}`}
            onBlur={(event) => {
              const raw = event.target.value.trim();
              const next = raw === "" ? null : Number(raw);
              if (next !== (page.value("story_points") ?? null)) page.write({ story_points: next });
            }}
          />
        </div>
        <div>
          <label htmlFor="task-start">Start date</label>
          <DatePicker
            id="task-start"
            aria-label="Start date"
            style={{ width: "100%" }}
            disabled={!canEdit}
            value={page.value("start_date") ? dayjs(asText(page.value("start_date"))) : null}
            onChange={(next: dayjs.Dayjs | null) => page.write({ start_date: next?.format("YYYY-MM-DD") ?? null })}
          />
        </div>
      </div>

      {!isEpic && (
        <>
          <div className="nx-pl-section-label">Epic</div>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            aria-label="Epic"
            placeholder="No epic"
            style={{ width: "100%" }}
            disabled={!canEdit}
            loading={epics.isLoading}
            value={asText(page.value("epic_id")) || undefined}
            onChange={(next: string | undefined) => page.write({ epic_id: next ?? null })}
            options={(epics.data?.items ?? []).filter((epic) => epic.id !== id).map((epic) => ({ value: epic.id, label: `${epic.reference} · ${epic.title}` }))}
          />
        </>
      )}

      <div className="nx-pl-section-label">Sprint</div>
      <Select
        allowClear
        aria-label="Sprint"
        placeholder="Backlog"
        style={{ width: "100%" }}
        disabled={!data?.can_manage}
        value={data?.sprint?.id}
        onChange={(next: string | undefined) => plan.mutate(next ?? null)}
        options={[
          ...(sprints.data?.items ?? [])
            .filter((sprint) => sprint.state !== "COMPLETED" || sprint.id === data?.sprint?.id)
            .map((sprint) => ({ value: sprint.id, label: `${sprint.name}${sprint.state === "ACTIVE" ? " (running)" : ""}` })),
        ]}
      />

      <div className="nx-pl-section-label">Flag</div>
      <Space direction="vertical" style={{ width: "100%" }} size={6}>
        <Space size={8}>
          <Switch
            size="small"
            aria-label="Flag as blocked"
            checked={Boolean(blocked)}
            disabled={!canEdit}
            onChange={(on) => page.write({ blocked_reason: on ? "Blocked" : null })}
            data-testid="task-flag"
          />
          <span>{blocked ? "Blocked" : "Not blocked"}</span>
        </Space>
        {blocked && (
          <Input
            aria-label="Why it is blocked"
            defaultValue={blocked}
            key={`blocked-${blocked}`}
            disabled={!canEdit}
            maxLength={240}
            onBlur={(event) => {
              const reason = event.target.value.trim();
              if (reason && reason !== blocked) page.write({ blocked_reason: reason });
            }}
          />
        )}
        <Space size={8}>
          <Switch
            size="small"
            aria-label="Milestone"
            checked={Boolean(page.value("is_milestone"))}
            disabled={!canEdit}
            onChange={(on) => page.write({ is_milestone: on })}
          />
          <span>Milestone on the timeline</span>
        </Space>
      </Space>

      <div className="nx-pl-section-label">Card cover</div>
      <div className="nx-pl-swatches" role="group" aria-label="Card cover colour">
        <button type="button" className="nx-pl-swatch is-none" aria-label="No cover" aria-pressed={!cover} disabled={!canEdit} onClick={() => page.write({ cover_color: null })} />
        {COVERS.map((colour) => (
          <button
            key={colour}
            type="button"
            className="nx-pl-swatch"
            style={{ ["--nx-pl-tone" as string]: colour }}
            aria-label={`Cover ${colour}`}
            aria-pressed={cover === colour}
            disabled={!canEdit}
            onClick={() => page.write({ cover_color: colour })}
          />
        ))}
      </div>

      <div className="nx-pl-section-label">Watchers</div>
      <div className="nx-pl-watchers">
        {(data?.watchers ?? []).map((person) => (
          <Tooltip key={person.id} title={person.name}>
            <span className="nx-pl-who">{person.initials}</span>
          </Tooltip>
        ))}
        <Button
          icon={<PlanIcon name="eye" />}
          loading={watch.isPending}
          onClick={() => watch.mutate(!data?.watching)}
          data-testid="task-watch"
        >
          {data?.watching ? "Stop watching" : "Watch"}
        </Button>
      </div>

      <div className="nx-pl-section-label">Repeat</div>
      <Space wrap>
        <span data-testid="task-recurrence">{data?.recurrence ? data.recurrence.summary : "Does not repeat"}</span>
        {data?.can_manage && (
          <Button icon={<PlanIcon name="repeat" />} onClick={() => setRepeating(true)} data-testid="task-repeat">
            {data.recurrence ? "Change" : "Repeat…"}
          </Button>
        )}
      </Space>
      {data?.recurrence?.next_run_at && (
        <Typography.Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 4 }}>
          Next copy {relativeTime(data.recurrence.next_run_at)} · {data.recurrence.occurrences} made so far
        </Typography.Text>
      )}
      {data?.status_changed_at && (
        <Typography.Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 10 }}>
          In this status since {relativeTime(data.status_changed_at)}
        </Typography.Text>
      )}

      <RecurrenceModal open={repeating} id={id} current={data?.recurrence ?? null} onClose={() => setRepeating(false)} onSaved={refresh} />
    </Card>
  );
}

/** How a task repeats: daily, weekly on chosen days, monthly, or every N days/weeks. */
export function RecurrenceModal({
  open,
  id,
  current,
  onClose,
  onSaved,
}: {
  open: boolean;
  id: string;
  current: Recurrence | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const frequency = Form.useWatch("frequency", form) as Recurrence["frequency"] | undefined;
  const save = useMutation({
    mutationFn: (values: Partial<Recurrence>) => planningApi.setRecurrence(id, values),
    onSuccess: (result) => {
      message.success(result.recurrence.summary);
      onSaved();
      onClose();
    },
    onError: (error) => message.error(failure(error)),
  });
  const clear = useMutation({
    mutationFn: () => planningApi.clearRecurrence(id),
    onSuccess: () => {
      message.success("This task no longer repeats");
      onSaved();
      onClose();
    },
    onError: (error) => message.error(failure(error)),
  });
  return (
    <Modal
      open={open}
      title="Repeat this task"
      okText="Save"
      confirmLoading={save.isPending}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnClose
      footer={(origin) => (
        <>
          {current && (
            <Button danger onClick={() => clear.mutate()} loading={clear.isPending} style={{ float: "left" }}>
              Stop repeating
            </Button>
          )}
          {origin}
        </>
      )}
    >
      <Typography.Paragraph type="secondary">
        When it comes due, the scheduler makes a fresh copy — same title, checklist unticked, the same length
        between start and due — and moves on to the next date.
      </Typography.Paragraph>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          frequency: current?.frequency ?? "WEEKLY",
          interval: current?.interval ?? 1,
          unit: current?.unit ?? "DAY",
          weekdays: current?.weekdays.length ? current.weekdays : [0],
          month_day: current?.month_day ?? 1,
          until: current?.until ? dayjs(current.until) : null,
        }}
        onFinish={(values: { frequency: Recurrence["frequency"]; interval: number; unit: "DAY" | "WEEK"; weekdays: number[]; month_day: number; until: dayjs.Dayjs | null }) =>
          save.mutate({
            frequency: values.frequency,
            interval: values.interval,
            unit: values.unit,
            weekdays: values.frequency === "WEEKLY" ? values.weekdays : [],
            month_day: values.frequency === "MONTHLY" ? values.month_day : null,
            until: values.until ? values.until.format("YYYY-MM-DD") : null,
          })
        }
      >
        <Form.Item name="frequency" label="Repeats">
          <Segmented
            options={[
              { value: "DAILY", label: "Daily" },
              { value: "WEEKLY", label: "Weekly" },
              { value: "MONTHLY", label: "Monthly" },
              { value: "CUSTOM", label: "Custom" },
            ]}
          />
        </Form.Item>
        <Space align="start" wrap>
          <Form.Item name="interval" label="Every">
            <InputNumber aria-label="Every" min={1} max={365} />
          </Form.Item>
          {frequency === "CUSTOM" && (
            <Form.Item name="unit" label="Unit">
              <Select aria-label="Unit" style={{ width: 110 }} options={[{ value: "DAY", label: "days" }, { value: "WEEK", label: "weeks" }]} />
            </Form.Item>
          )}
          {frequency === "MONTHLY" && (
            <Form.Item name="month_day" label="On day">
              <InputNumber aria-label="Day of the month" min={1} max={31} />
            </Form.Item>
          )}
        </Space>
        {frequency === "WEEKLY" && (
          <Form.Item name="weekdays" label="On">
            <Checkbox.Group options={WEEKDAYS.map((label, value) => ({ label, value }))} />
          </Form.Item>
        )}
        <Form.Item name="until" label="Until (optional)">
          <DatePicker aria-label="Until" style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function Related({ items, onRemove, empty }: { items: (PlanBrief & { dependency_id?: string })[]; onRemove?: (item: PlanBrief & { dependency_id?: string }) => void; empty: string }) {
  if (items.length === 0) return <Typography.Text type="secondary">{empty}</Typography.Text>;
  return (
    <ul className="nx-pl-links-list">
      {items.map((item) => (
        <li key={item.dependency_id ?? item.id}>
          <KindBadge kind={item.kind} />
          <span className="nx-pl-ref">{item.reference}</span>
          <Link to={`/tasks/${item.id}`}>{item.title}</Link>
          {item.end && <span className="nx-pl-chip">{shortDate(item.end)}</span>}
          <StatusTag status={item.status} />
          <Points value={item.story_points} />
          {onRemove && (
            <Button type="text" icon={<DeleteOutlined />} aria-label={`Remove ${item.reference}`} onClick={() => onRemove(item)} />
          )}
        </li>
      ))}
    </ul>
  );
}

/** Subtasks (and, for an epic, its stories) and what this waits on / holds up. */
export function TaskRelations({ id, page }: { id: string; page: RecordPage }) {
  const { message, modal } = AntApp.useApp();
  const planning = useTaskPlanning(id);
  const refresh = useRefresh(id);
  const [title, setTitle] = useState("");
  const [waitOn, setWaitOn] = useState<string | undefined>();
  const canEdit = Boolean(page.record?.can_edit);
  const data = planning.data;

  const addSubtask = useMutation({
    mutationFn: (text: string) =>
      recordsApi.create("task", {
        title: text,
        parent_id: id,
        project_id: asText(page.value("project_id")) || null,
        epic_id: asText(page.value("epic_id")) || null,
        status: "NEW",
      }),
    onSuccess: () => {
      setTitle("");
      message.success("Subtask added");
    },
    onError: (error) => message.error(failure(error)),
    onSettled: refresh,
  });
  const link = useMutation({
    mutationFn: (predecessor: string) => planningApi.link({ predecessor_id: predecessor, successor_id: id }),
    onSuccess: (created) => {
      setWaitOn(undefined);
      message[created.violated ? "warning" : "success"](
        created.violated ? "Linked — but this task starts before that one ends. See the timeline." : "Dependency added",
      );
    },
    onError: (error) => message.error(failure(error)),
    onSettled: refresh,
  });
  const unlink = (item: PlanBrief & { dependency_id?: string }) =>
    modal.confirm({
      title: `Remove the dependency on ${item.reference}?`,
      okText: "Remove",
      okButtonProps: { danger: true },
      onOk: () =>
        planningApi
          .unlink(item.dependency_id!)
          .then(() => message.success("Dependency removed"))
          .catch((error: unknown) => message.error(failure(error)))
          .finally(refresh),
    });

  const candidates = useQuery({
    queryKey: ["timeline-candidates", asText(page.value("project_id"))],
    queryFn: ({ signal }) =>
      planningApi.timeline({ project_id: asText(page.value("project_id")) || undefined, group: "project" }, signal),
    enabled: canEdit && Boolean(page.value("project_id")),
  });
  const options = (candidates.data?.groups ?? [])
    .flatMap((group) => group.items)
    .filter((bar) => bar.id !== id && !data?.blocked_by.some((item) => item.id === bar.id))
    .map((bar) => ({ value: bar.id, label: `${bar.reference} · ${bar.title}` }));

  const total = data?.subtasks.length ?? 0;
  const done = data?.subtasks.filter((item) => item.status === "DONE").length ?? 0;

  return (
    <>
      {data?.children && data.children.length > 0 && (
        <Card size="small" className="nu-block" title={<Space>Work in this epic <Tag>{data.children_done} of {data.children.length} done</Tag></Space>}>
          <Related items={data.children} empty="" />
        </Card>
      )}
      <Card
        size="small"
        className="nu-block"
        data-testid="task-subtasks"
        title={
          <Space size={8}>
            <span>Subtasks</span>
            {total > 0 && <Typography.Text type="secondary">{done} of {total}</Typography.Text>}
          </Space>
        }
        extra={data?.parent ? <Link to={`/tasks/${data.parent.id}`}>Parent: {data.parent.reference}</Link> : undefined}
      >
        <Related items={data?.subtasks ?? []} empty="No subtasks." />
        {canEdit && (
          <Space.Compact style={{ width: "100%", marginTop: 10 }}>
            <Input
              aria-label="New subtask"
              placeholder="Add a subtask"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onPressEnter={() => title.trim() && addSubtask.mutate(title.trim())}
            />
            <Button icon={<PlusOutlined />} disabled={!title.trim()} loading={addSubtask.isPending} onClick={() => addSubtask.mutate(title.trim())}>
              Add
            </Button>
          </Space.Compact>
        )}
      </Card>
      <Card size="small" className="nu-block" title="Dependencies" data-testid="task-dependencies">
        <div className="nx-pl-section-label" style={{ marginTop: 0 }}>
          Waits on
        </div>
        <Related items={data?.blocked_by ?? []} onRemove={canEdit ? unlink : undefined} empty="Nothing — it can start any time." />
        <div className="nx-pl-section-label">Holds up</div>
        <Related items={data?.blocking ?? []} onRemove={canEdit ? unlink : undefined} empty="Nothing waits on this." />
        {canEdit && page.value("project_id") ? (
          <Space.Compact style={{ width: "100%", marginTop: 10 }}>
            <Select
              showSearch
              optionFilterProp="label"
              aria-label="Waits on"
              placeholder="Make this wait on…"
              style={{ width: "100%" }}
              value={waitOn}
              loading={candidates.isLoading}
              onChange={setWaitOn}
              options={options}
            />
            <Button icon={<PlanIcon name="link" />} disabled={!waitOn} loading={link.isPending} onClick={() => waitOn && link.mutate(waitOn)}>
              Link
            </Button>
          </Space.Compact>
        ) : null}
      </Card>
    </>
  );
}

/** A checklist whose steps can be dragged into a new order (and ticked, added, removed). */
export function ReorderableChecklist({
  items,
  canEdit,
  saving,
  onChange,
}: {
  items: { text: string; done: boolean }[];
  canEdit: boolean;
  saving: boolean;
  onChange: (items: { text: string; done: boolean }[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const keyed = items.map((item, index) => ({ ...item, key: `step-${index}` }));
  const drag = useBoardDrag({
    enabled: canEdit && !saving,
    lanes: ["checklist"],
    items: () => keyed.map((item) => item.key),
    onDrop: (key, _from, to) => {
      const from = keyed.findIndex((item) => item.key === key);
      if (from < 0) return;
      const rest = items.filter((_item, index) => index !== from);
      onChange([...rest.slice(0, to.index), items[from]!, ...rest.slice(to.index)]);
    },
    describe: (key) => keyed.find((item) => item.key === key)?.text ?? "the step",
    laneName: () => "the checklist",
  });
  const add = () => {
    if (!draft.trim()) return;
    onChange([...items, { text: draft.trim(), done: false }]);
    setDraft("");
  };
  return (
    <div data-drop-lane="checklist" className={drag.laneProps("checklist").className}>
      <ul className="nx-pl-checklist" data-drop-list="checklist">
        {drag.renderLane(
          "checklist",
          keyed,
          (item) => item.key,
          (item, index) => {
            const { className, ...handlers } = drag.cardProps(item.key, "checklist");
            return (
              <li key={item.key}>
                <div {...handlers} className={`nx-pl-checklist-row ${className}`} data-testid={`checklist-row-${index}`}>
                  {canEdit && <HolderOutlined className="nx-pl-handle" aria-hidden />}
                  <Checkbox
                    checked={item.done}
                    disabled={!canEdit || saving}
                    onChange={(event) =>
                      onChange(items.map((entry, position) => (position === index ? { ...entry, done: event.target.checked } : entry)))
                    }
                  >
                    <span className={item.done ? "nu-checklist-done" : undefined}>{item.text}</span>
                  </Checkbox>
                  {canEdit && (
                    <Button
                      type="text"
                      data-no-drag
                      aria-label={`Remove ${item.text}`}
                      icon={<DeleteOutlined />}
                      onClick={() => onChange(items.filter((_entry, position) => position !== index))}
                    />
                  )}
                </div>
              </li>
            );
          },
          (height) => <DropGap key="gap" height={Math.min(height, 36)} label="" />,
        )}
      </ul>
      {canEdit && (
        <Space.Compact style={{ width: "100%" }}>
          <Input aria-label="New checklist item" placeholder="Add a step" value={draft} onChange={(event) => setDraft(event.target.value)} onPressEnter={add} />
          <Button icon={<PlusOutlined />} disabled={!draft.trim()} onClick={add}>
            Add
          </Button>
        </Space.Compact>
      )}
      {drag.overlay}
    </div>
  );
}

/** "Save as template" — the task's title, checklist, estimate and labels, for next time. */
export function SaveAsTemplateButton({ id, title, disabled }: { id: string; title: string; disabled?: boolean }) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(title);
  const save = useMutation({
    mutationFn: () => planningApi.saveAsTemplate(id, name.trim() || title),
    onSuccess: (template) => {
      message.success(`Saved as the template “${template.name}”`);
      void queryClient.invalidateQueries({ queryKey: ["task-templates"] });
      setOpen(false);
    },
    onError: (error) => message.error(failure(error)),
  });
  return (
    <>
      <Tooltip title={disabled ? "Your role does not include tasks.manage" : ""}>
        <Button icon={<PlanIcon name="template" />} disabled={disabled} onClick={() => setOpen(true)} data-testid="task-save-template">
          Save as template
        </Button>
      </Tooltip>
      <Modal open={open} title="Save as a template" okText="Save" confirmLoading={save.isPending} onCancel={() => setOpen(false)} onOk={() => save.mutate()}>
        <Typography.Paragraph type="secondary">
          The title, description, checklist (unticked), estimate, points, labels and cover are kept, and the length from
          start to due becomes “due in”.
        </Typography.Paragraph>
        <Input aria-label="Template name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
      </Modal>
    </>
  );
}

export type { Planning };

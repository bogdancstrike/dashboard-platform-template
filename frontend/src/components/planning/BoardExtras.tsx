/**
 * What the task board borrows from Jira and Taiga (§18): swimlanes, WIP limits,
 * a card's cover, points, checklist progress, flag, epic and age, an inline
 * "add a card" in every lane, templates, and keyboard shortcuts.
 *
 * Kept beside the board rather than inside it so the board's own decisions
 * (one query per lane, the drag, the optimistic move) stay readable, and so
 * each of these can be tested on its own.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Input, InputNumber, Modal, Select, Space, Tooltip, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";

import { api } from "@/api/client";
import { planningApi, type LaneSetting, type TaskTemplate } from "@/api/planning";
import type { Person } from "@/api/directory";
import { recordsApi } from "@/api/records";
import { refreshRecordViews } from "@/lib/refresh";

import { Points } from "./PlanItem";
import { projectOptions, useProjects } from "./useProjects";
import { FEATURES, withFeature } from "@/settings/features";
import { STALE, queryKeys } from "@/lib/queryKeys";
import { apiMessageToast } from "@/lib/errors";

export type Swimlane = "none" | "assignee" | "priority" | "epic";

export const SWIMLANES: { value: Swimlane; label: string }[] = [
  { value: "none", label: "No swimlanes" },
  { value: "assignee", label: "By assignee" },
  { value: "priority", label: "By priority" },
  { value: "epic", label: "By epic" },
];

/** The record field a swimlane is, so a drop across swimlanes can write it. */
export const SWIMLANE_FIELD: Record<Exclude<Swimlane, "none">, string> = {
  assignee: "assignee_id",
  priority: "priority",
  epic: "epic_id",
};

const PRIORITY_ORDER = ["CRITICAL", "HIGH", "NORMAL", "LOW"];

/** A lane id that carries both its swimlane and its status. */
export function laneKey(swim: string, status: string): string {
  return `${swim}|${status}`;
}

export function parseLane(key: string): { swim: string; status: string } {
  const at = key.lastIndexOf("|");
  return at < 0 ? { swim: "all", status: key } : { swim: key.slice(0, at), status: key.slice(at + 1) };
}

/** Which swimlane a card is in — `""` is "none of them" (no assignee, no epic). */
export function swimOf(task: Record<string, unknown>, swim: Swimlane): string {
  if (swim === "none") return "all";
  const value = task[SWIMLANE_FIELD[swim]];
  return typeof value === "string" ? value : "";
}

/** The swimlanes present, in a sensible order: priorities by severity, the rest by name, "none" last. */
export function swimlaneOrder(keys: string[], swim: Swimlane, label: (key: string) => string): string[] {
  const unique = Array.from(new Set(keys));
  if (swim === "none") return ["all"];
  if (swim === "priority") {
    return unique.sort((a, b) => PRIORITY_ORDER.indexOf(a) - PRIORITY_ORDER.indexOf(b));
  }
  return unique.sort((a, b) => (a === "" ? 1 : b === "" ? -1 : label(a).localeCompare(label(b))));
}

/** How long a card has sat in its lane, as Jira's dots: one per few days, red when stale. */
export function ageDots(since: string | null | undefined, now = Date.now()): { dots: number; days: number; stale: boolean } {
  if (!since) return { dots: 0, days: 0, stale: false };
  const days = Math.max(0, Math.floor((now - new Date(since).getTime()) / 86_400_000));
  const dots = days < 2 ? 0 : days < 4 ? 1 : days < 7 ? 2 : days < 14 ? 3 : 4;
  return { dots, days, stale: days >= 14 };
}

export function AgeDots({ since, closed }: { since: string | null | undefined; closed?: boolean }) {
  const { dots, days, stale } = ageDots(since);
  if (closed || dots === 0) return null;
  return (
    <Tooltip title={`In this lane for ${days} days`}>
      <span className={`nx-pl-age${stale ? " is-stale" : ""}`} role="img" aria-label={`${days} days in this lane`} data-testid="card-age">
        {[0, 1, 2, 3].map((index) => (
          <i key={index} className={index < dots ? "is-on" : undefined} />
        ))}
      </span>
    </Tooltip>
  );
}

/** The extra lines on a card: cover, flag, epic, points, checklist. */
export function CardBadges({
  task,
  epicName,
}: {
  task: {
    story_points?: number | null;
    blocked_reason?: string | null;
    checklist?: { done?: boolean }[] | null;
    epic_id?: string | null;
  };
  epicName?: string;
}) {
  const list = Array.isArray(task.checklist) ? task.checklist : [];
  const done = list.filter((item) => item.done).length;
  return (
    <>
      {(task.blocked_reason || epicName) && (
        <span className="nx-pl-chips">
          {task.blocked_reason && (
            <Tooltip title={task.blocked_reason}>
              <span className="nx-pl-flag" data-testid="card-flag">
                ⚑ {task.blocked_reason}
              </span>
            </Tooltip>
          )}
          {epicName && <span className="nx-pl-chip is-epic">{epicName}</span>}
        </span>
      )}
      {(list.length > 0 || task.story_points != null) && (
        <span className="nu-task-meta">
          {list.length > 0 && (
            <span aria-label={`Checklist ${done} of ${list.length}`} data-testid="card-checklist">
              ☑ {done}/{list.length}
            </span>
          )}
          <span className="nx-rec-spacer" />
          {task.story_points != null && <Points value={Number(task.story_points)} />}
        </span>
      )}
    </>
  );
}

/** "3 / 4" beside a lane name; red when over the limit. */
export function WipBadge({ count, setting }: { count: number; setting?: LaneSetting }) {
  if (!setting?.wip_limit) return null;
  const over = count > setting.wip_limit;
  return (
    <Tooltip title={over ? `Over its work-in-progress limit of ${setting.wip_limit}` : `Limit ${setting.wip_limit}`}>
      <span className={`nx-pl-wip${over ? " is-over" : ""}`} data-testid={`wip-${setting.status}`}>
        {count}/{setting.wip_limit}
      </span>
    </Tooltip>
  );
}

export function useLaneSettings() {
  return useQuery({ queryKey: queryKeys.taskLanes(), queryFn: ({ signal }) => planningApi.lanes(signal), staleTime: STALE.short });
}

/** Set the work-in-progress limit of every lane at once. */
export function WipLimitsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const lanes = useLaneSettings();
  const [limits, setLimits] = useState<Record<string, number | null>>({});
  useEffect(() => {
    if (open && lanes.data) setLimits(Object.fromEntries(lanes.data.items.map((item) => [item.status, item.wip_limit])));
  }, [open, lanes.data]);
  const save = useMutation({
    mutationFn: () => planningApi.setLanes(limits),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.taskLanes(), saved);
      message.success("Lane limits saved");
      onClose();
    },
    onError: apiMessageToast(message, "Those limits could not be saved."),
  });
  return (
    <Modal open={open} title="Work-in-progress limits" okText="Save" confirmLoading={save.isPending} onCancel={onClose} onOk={() => save.mutate()}>
      <Typography.Paragraph type="secondary">
        A limit warns and never refuses: a lane over its limit turns red, and the drop still lands.
      </Typography.Paragraph>
      <Space direction="vertical" style={{ width: "100%" }}>
        {(lanes.data?.items ?? []).map((lane) => (
          <Space key={lane.status} style={{ width: "100%", justifyContent: "space-between" }}>
            <span>
              {lane.status.replace(/_/g, " ").toLowerCase()} <Typography.Text type="secondary">· {lane.count} now</Typography.Text>
            </span>
            <InputNumber
              aria-label={`Limit for ${lane.status}`}
              min={1}
              max={999}
              placeholder="No limit"
              value={limits[lane.status] ?? null}
              onChange={(value) => setLimits((current) => ({ ...current, [lane.status]: value ?? null }))}
            />
          </Space>
        ))}
      </Space>
    </Modal>
  );
}

/** The "+ Add a card" at the foot of a lane, which becomes an input. */
export function QuickCreate({ status, extra, onCreated }: { status: string; extra?: Record<string, unknown>; onCreated?: (id: string) => void }) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const create = useMutation({
    mutationFn: (text: string) => recordsApi.create("task", { title: text, status, ...extra }),
    onSuccess: (made) => {
      setTitle("");
      message.success(`${made.subtitle || "Task"} added`);
      refreshRecordViews(queryClient);
      onCreated?.(made.id);
    },
    onError: apiMessageToast(message, "That card could not be added."),
  });
  if (!open) {
    return (
      <button type="button" className="nx-rec-lane-new" onClick={() => setOpen(true)} data-testid={`quick-add-${status}`}>
        <PlusOutlined /> Add a card
      </button>
    );
  }
  return (
    <div className="nx-pl-quick">
      <Input
        autoFocus
        aria-label={`New card in ${status.replace(/_/g, " ").toLowerCase()}`}
        placeholder="What needs doing?"
        value={title}
        disabled={create.isPending}
        onChange={(event) => setTitle(event.target.value)}
        onPressEnter={() => title.trim() && create.mutate(title.trim())}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            setTitle("");
          }
        }}
        onBlur={() => !title.trim() && setOpen(false)}
        data-testid={`quick-input-${status}`}
      />
    </div>
  );
}

/** Pick a template, name the copy, choose the project — and the task exists. */
function TemplatePickerInner({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const projects = useProjects();
  const templates = useQuery({
    queryKey: queryKeys.taskTemplates(),
    queryFn: ({ signal }) => planningApi.templates({}, signal),
    enabled: open,
  });
  const [chosen, setChosen] = useState<TaskTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [project, setProject] = useState<string | undefined>();
  const use = useMutation({
    mutationFn: () => planningApi.useTemplate(chosen!.id, { title: title.trim() || chosen!.title, project_id: project }),
    onSuccess: (made) => {
      message.success(`${made.title} created from “${chosen?.name}”`);
      refreshRecordViews(queryClient);
      onClose();
      setChosen(null);
      onCreated(made.id);
    },
    onError: apiMessageToast(message, "The task could not be created."),
  });
  return (
    <Modal
      open={open}
      width={720}
      title="New task from a template"
      okText="Create task"
      okButtonProps={{ disabled: !chosen }}
      confirmLoading={use.isPending}
      onCancel={onClose}
      onOk={() => use.mutate()}
    >
      <div className="nx-pl-templates" role="list" data-testid="template-list">
        {(templates.data?.items ?? []).map((template) => (
          <button
            key={template.id}
            type="button"
            role="listitem"
            className="nx-pl-template"
            style={{ ["--nx-pl-tone" as string]: template.cover_color ?? "transparent" }}
            aria-pressed={chosen?.id === template.id}
            onClick={() => {
              setChosen(template);
              setTitle(template.title);
            }}
          >
            <strong>{template.name}</strong>
            <span>
              {template.kind.toLowerCase()} · {template.checklist.length} steps
              {template.story_points != null ? ` · ${template.story_points} pts` : ""}
              {template.due_in_days != null ? ` · due in ${template.due_in_days}d` : ""}
            </span>
            <span>Used {template.usage_count}×</span>
          </button>
        ))}
        {templates.data?.items.length === 0 && <Typography.Text type="secondary">No templates yet — save a task as one from its page.</Typography.Text>}
      </div>
      {chosen && (
        <Space direction="vertical" style={{ width: "100%", marginTop: 16 }}>
          <Input aria-label="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            aria-label="Project"
            placeholder="No project"
            style={{ width: "100%" }}
            value={project}
            onChange={setProject}
            options={projectOptions(projects.data)}
          />
        </Space>
      )}
    </Modal>
  );
}

/**
 * The board's keys: `c` adds a card, `j`/`k` walk the cards, `/` searches,
 * `?` lists them. Ignored while typing, and while a modal is open.
 */
export function useBoardShortcuts({ onCreate, onHelp }: { onCreate: () => void; onHelp: () => void }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable=true], .ant-modal, .ant-select")) return;
      if (document.querySelector(".ant-modal-wrap:not([style*='display: none'])")) return;
      const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-board-card]"));
      const at = cards.findIndex((card) => card === document.activeElement);
      if (event.key === "c") {
        event.preventDefault();
        onCreate();
      } else if (event.key === "j" || event.key === "k") {
        if (cards.length === 0) return;
        event.preventDefault();
        const next = event.key === "j" ? Math.min(cards.length - 1, at + 1) : Math.max(0, at < 0 ? 0 : at - 1);
        cards[next]?.focus();
        cards[next]?.scrollIntoView({ block: "nearest", inline: "nearest" });
      } else if (event.key === "/") {
        const search = document.querySelector<HTMLInputElement>("[data-board-search] input, input[data-board-search]");
        if (search) {
          event.preventDefault();
          search.focus();
        }
      } else if (event.key === "?") {
        event.preventDefault();
        onHelp();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCreate, onHelp]);
}

export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows: [string, string][] = [
    ["c", "Add a task"],
    ["j / k", "Next / previous card"],
    ["Enter", "Open the focused card"],
    ["Space, ← → ↑ ↓, Space", "Pick a card up, move it, drop it"],
    ["/", "Search the board"],
    ["?", "This list"],
  ];
  return (
    <Modal open={open} title="Keyboard shortcuts" footer={null} onCancel={onClose}>
      <dl className="nx-pl-shortcuts" style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "8px 16px", margin: 0 }}>
        {rows.map(([keys, what]) => (
          <div key={keys} style={{ display: "contents" }}>
            <dt>
              {keys.split(" ").map((part, index) => (part.length <= 5 && part !== "/" && part !== "," ? <kbd key={index}>{part}</kbd> : <span key={index}> {part} </span>))}
            </dt>
            <dd style={{ margin: 0 }}>{what}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}


/** Everybody's name by id, for assignee swimlanes (the directory pages by fifty). */
export function usePeopleNames(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.planningPeople(),
    enabled,
    staleTime: STALE.long,
    queryFn: async ({ signal }) => {
      const names = new Map<string, Person>();
      for (let page = 1; page <= 6; page += 1) {
        const batch = await api.get<{ items: Person[]; pages: number }>("/api/directory/people", {
          params: { q: "", page, page_size: 50 },
          signal,
        });
        batch.items.forEach((person) => names.set(person.id, person));
        if (page >= batch.pages) break;
      }
      return names;
    },
  });
}

/** Rendered only while its feature flag is on (§27). */
export const TemplatePicker = withFeature(FEATURES.recurringTasks, TemplatePickerInner);

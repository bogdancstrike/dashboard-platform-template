/**
 * What each kind of step is: its outputs, its icon, what a fresh one starts
 * with, and how its card summarises it.
 *
 * A registry rather than a switch in each function. The node types (trigger,
 * condition, branch, action) differ in their ports and their summary; the
 * action kinds differ in their icon, their blank data and their summary line.
 * A new action kind is one entry in ACTION_KINDS, and the canvas, the palette
 * and the card all follow.
 */

import type { GraphNode } from "@/api/workflowGraph";

/** A node setting as text: strings and numbers as they are, anything else blank. */
export function str(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

export interface SummaryLabels {
  triggers: Record<string, string>;
  actions: Record<string, string>;
  datasets: Record<string, string>;
}

type Data = Record<string, unknown>;

interface ActionKind {
  icon: string;
  /** Data a fresh step of this kind starts with, beyond its kind. */
  blank?: () => Data;
  /** Its outputs, when it has more than one. */
  ports?: string[];
  /** The card's second line; the step's title when absent. */
  detail?: (data: Data, labels: SummaryLabels) => string;
}

const RECIPIENTS = () => ({ user_ids: [], role: "", owner: true });

export const ACTION_KINDS: Record<string, ActionKind> = {
  NOTIFY: { icon: "bell", blank: () => ({ recipients: RECIPIENTS(), title: "{rule}: {record}" }) },
  EMAIL: { icon: "mail", blank: () => ({ recipients: RECIPIENTS(), subject: "{rule}: {record}" }), detail: (data) => str(data.subject) },
  TASK: { icon: "check", blank: () => ({ title: "Follow up {record}", priority: "HIGH" }) },
  WEBHOOK: { icon: "plug", blank: () => ({ url: "" }), detail: (data) => str(data.url) || "No address yet" },
  UPDATE_FIELD: { icon: "pen", detail: (data) => (data.field ? `${str(data.field)} = ${str(data.value)}` : "Choose a field") },
  ASSIGN: { icon: "user", blank: () => ({ to_owner: true }), detail: (data) => (data.to_owner ? "to the workflow's owner" : "to a person") },
  CREATE_RECORD: {
    icon: "plus",
    blank: () => ({ resource_type: "task", values: { title: "Follow up {record}" } }),
    detail: (data, labels) => labels.datasets[str(data.resource_type)] ?? "",
  },
  WAIT: { icon: "calendar", blank: () => ({ minutes: 60 }), detail: (data) => `for ${minutesLabel(Number(data.minutes ?? 0))}` },
  APPROVAL: { icon: "shield", blank: () => ({ title: "Approve {record}" }), ports: ["approved", "rejected"] },
};

/** The outputs of a node, in the order they are drawn left to right. */
export function portsOf(node: Pick<GraphNode, "type" | "data">): string[] {
  if (node.type === "branch") return ["true", "false"];
  if (node.type === "action") return ACTION_KINDS[str(node.data.kind)]?.ports ?? ["out"];
  return ["out"];
}

export const PORT_LABEL: Record<string, string> = {
  out: "",
  true: "Yes",
  false: "No",
  approved: "Approved",
  rejected: "Rejected",
};

/** Data a fresh node of each action kind starts with. */
export function blankData(kind: string): Data {
  return { kind, ...ACTION_KINDS[kind]?.blank?.() };
}

const TYPE_ICON: Record<string, string> = { trigger: "flow", condition: "filter", branch: "graph" };

export function iconFor(node: Pick<GraphNode, "type" | "data">): string {
  return TYPE_ICON[node.type] ?? ACTION_KINDS[str(node.data.kind)]?.icon ?? "sliders";
}

export function minutesLabel(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

/** The second line of a node: what it is set to do, in a few words. */
export function summaryOf(node: GraphNode, labels: SummaryLabels): { title: string; detail: string } {
  const data = node.data;
  if (node.type === "trigger") return triggerSummary(data, labels);
  if (node.type === "condition" || node.type === "branch") {
    const count = countTreeRules(data.tree);
    return {
      title: node.type === "branch" ? "If / else" : "Only if",
      detail: count ? `${count} rule${count === 1 ? "" : "s"}` : "No rules yet",
    };
  }
  const kind = str(data.kind);
  const title = labels.actions[kind] ?? kind;
  const detail = ACTION_KINDS[kind]?.detail;
  return { title, detail: detail ? detail(data, labels) : str(data.title) };
}

function triggerSummary(data: Data, labels: SummaryLabels): { title: string; detail: string } {
  const event = str(data.event);
  const dataset = labels.datasets[str(data.resource_type)] ?? "Choose a dataset";
  let detail = dataset;
  if (event === "FIELD_CHANGED" && data.field) detail = `${dataset} · ${str(data.field)}${data.to ? ` → ${str(data.to)}` : ""}`;
  if (event === "SCHEDULE") detail = `${dataset} · ${str(data.schedule)}`;
  if (event === "FORM_SUBMITTED" && data.form) detail = `${dataset} · ${str(data.form)}`;
  return { title: labels.triggers[event] ?? "Choose a trigger", detail };
}

export function countTreeRules(tree: unknown): number {
  if (!tree || typeof tree !== "object") return 0;
  const node = tree as { type?: string; children1?: unknown; children?: unknown };
  if (node.type === "rule") return 1;
  const children = node.children1 ?? node.children;
  const list = Array.isArray(children) ? children : children && typeof children === "object" ? Object.values(children) : [];
  return list.reduce((sum: number, child) => sum + countTreeRules(child), 0);
}

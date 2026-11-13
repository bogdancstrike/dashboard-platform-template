/**
 * What each wiki block *is* (§48): its name, what it is for, and how a new one
 * starts. Keyed on the whole `DocBlockKind` union, so a kind the server learns
 * without being described here fails to compile.
 */

import {
  AreaChartOutlined,
  BarChartOutlined,
  BorderHorizontalOutlined,
  CheckSquareOutlined,
  CodeOutlined,
  FileTextOutlined,
  FontSizeOutlined,
  LinkOutlined,
  NotificationOutlined,
  OrderedListOutlined,
  PictureOutlined,
  ScheduleOutlined,
  TableOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";

import type { DocBlock, DocBlockKind } from "@/api/docs";

export interface DocBlockSpec {
  label: string;
  hint: string;
  icon: ReactNode;
}

export const DOC_BLOCKS: Record<DocBlockKind, DocBlockSpec> = {
  heading: { label: "Heading", hint: "A section title.", icon: <FontSizeOutlined /> },
  text: { label: "Text", hint: "A paragraph — **bold**, *italic*, `code`, links.", icon: <FileTextOutlined /> },
  list: { label: "List", hint: "Bullets or numbers, one per line.", icon: <OrderedListOutlined /> },
  checklist: { label: "Checklist", hint: "Things to tick off.", icon: <CheckSquareOutlined /> },
  quote: { label: "Quote", hint: "Somebody else's words.", icon: <span aria-hidden>❝</span> },
  code: { label: "Code", hint: "Commands or code, in monospace.", icon: <CodeOutlined /> },
  callout: { label: "Callout", hint: "A note that must not be missed.", icon: <NotificationOutlined /> },
  image: { label: "Image", hint: "A picture from your files.", icon: <PictureOutlined /> },
  table: { label: "Table", hint: "Rows and columns of text.", icon: <TableOutlined /> },
  divider: { label: "Divider", hint: "A line between sections.", icon: <BorderHorizontalOutlined /> },
  chart: { label: "Chart", hint: "A live chart of a dataset — the report builder's chart.", icon: <AreaChartOutlined /> },
  report: { label: "Saved report", hint: "A report you already built, run afresh.", icon: <BarChartOutlined /> },
  record: { label: "Record", hint: "Mention a task, ticket, customer… and link the page to it.", icon: <LinkOutlined /> },
  action: { label: "Action item", hint: "Somebody, a date, and a task it becomes.", icon: <ScheduleOutlined /> },
};

/** The order the add menu offers them: words, structure, then data and work. */
export const DOC_BLOCK_ORDER: DocBlockKind[] = [
  "text", "heading", "list", "checklist", "quote", "callout", "code", "table", "divider",
  "image", "chart", "report", "record", "action",
];

let counter = 0;

export function blockId(): string {
  counter += 1;
  return `b${Date.now().toString(36)}${counter.toString(36)}`;
}

export function newDocBlock(kind: DocBlockKind): DocBlock {
  const id = blockId();
  switch (kind) {
    case "heading":
      return { id, kind, text: "", level: 2 };
    case "list":
      return { id, kind, items: [""], ordered: false };
    case "checklist":
      return { id, kind, items: [{ text: "", done: false }] };
    case "code":
      return { id, kind, text: "", language: "" };
    case "callout":
      return { id, kind, text: "", tone: "info" };
    case "table":
      return { id, kind, header: true, rows: [["", ""], ["", ""]] };
    case "image":
      return { id, kind, file_id: null, caption: "" };
    case "chart":
      return { id, kind, chart: "bar", aggregation: "count", show: "chart", caption: "" };
    case "report":
      return { id, kind, show: "chart", caption: "" };
    case "record":
      return { id, kind, resource_type: "", resource_id: "", label: "" };
    case "action":
      return { id, kind, text: "", assignee_id: null, due_date: null, task_id: null, done: false };
    case "divider":
      return { id, kind };
    default:
      return { id, kind, text: "" };
  }
}

/** Where a record of a kind lives in the app. */
export const RECORD_PATHS: Record<string, string> = {
  task: "/tasks",
  project: "/projects",
  customer: "/customers",
  order: "/orders",
  ticket: "/tickets",
  device: "/devices",
};

export function recordPath(resourceType: string, resourceId: string): string {
  return `${RECORD_PATHS[resourceType] ?? "/explore"}/${resourceId}`;
}

export const RECORD_LABELS: Record<string, string> = {
  task: "Task",
  project: "Project",
  customer: "Customer",
  order: "Order",
  ticket: "Ticket",
  device: "Device",
};

/** A checklist or list item, as text — the two shapes the server keeps. */
export function itemText(item: string | { text: string; done: boolean }): string {
  return typeof item === "string" ? item : item.text;
}

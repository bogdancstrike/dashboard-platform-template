/**
 * The wiki and meeting notes (§48–49).
 *
 * A page is a list of blocks saved whole, the same way a report document is —
 * and the data blocks (`chart`, `report`) carry the report builder's own block
 * shape, so they are drawn by the same preview component.
 */
export type DocBlockKind =
  | "heading"
  | "text"
  | "list"
  | "checklist"
  | "quote"
  | "code"
  | "callout"
  | "image"
  | "table"
  | "divider"
  | "chart"
  | "report"
  | "record"
  | "action";

export type CalloutTone = "info" | "success" | "warning" | "danger";

export interface DocBlock {
  id: string;
  kind: DocBlockKind;
  text?: string;
  level?: number;
  items?: Array<string | { text: string; done: boolean }>;
  ordered?: boolean;
  language?: string;
  tone?: CalloutTone;
  file_id?: string | null;
  caption?: string;
  rows?: string[][];
  header?: boolean;
  // chart / report — the report builder's block fields
  entity?: string;
  dimension?: string;
  granularity?: string;
  stack?: string;
  aggregation?: string;
  measure?: string;
  period?: string;
  chart?: string;
  show?: "chart" | "table" | "both";
  report_id?: string;
  filters?: Record<string, unknown>;
  // record
  resource_type?: string;
  resource_id?: string;
  label?: string;
  // action
  assignee_id?: string | null;
  due_date?: string | null;
  task_id?: string | null;
  done?: boolean;
}

export interface DocSpace {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string;
  kind: "GENERAL" | "MEETINGS";
  page_count: number;
}

export interface TreeItem {
  id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  position: number;
  updated_at: string;
  is_meeting: boolean;
}

export interface DocPerson {
  id: string;
  name: string;
  avatar_url: string | null;
}

export interface DocLink {
  id: string;
  resource_type: string;
  resource_id: string;
  label: string;
  source: "MANUAL" | "MENTION" | "ACTION";
}

export interface LinkedTask {
  id: string;
  reference: string;
  title: string;
  status: string;
  due_date: string | null;
  assignee: string | null;
}

export interface DocEvent {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  participants: Array<{ user_id: string | null; name: string | null; response: string | null }>;
}

export interface DocPage {
  id: string;
  space: DocSpace;
  parent_id: string | null;
  title: string;
  icon: string | null;
  blocks: DocBlock[];
  version: number;
  template: string | null;
  breadcrumbs: Array<{ id: string; title: string; icon: string | null }>;
  links: DocLink[];
  tasks: Record<string, LinkedTask>;
  event: DocEvent | null;
  created_by: DocPerson | null;
  updated_by: DocPerson | null;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
  can_create_tasks: boolean;
  /** Only on "Take notes": whether the page was just made. */
  created?: boolean;
}

export interface PageRef {
  id: string;
  title: string;
  icon: string | null;
  space: string;
  space_id: string;
  updated_at: string;
  is_meeting?: boolean;
  snippet?: string;
  source?: DocLink["source"];
  updated_by?: DocPerson | null;
}

export interface Revision {
  id: string;
  version: number;
  title: string;
  note: string | null;
  author: DocPerson | null;
  created_at: string;
  blocks: number;
  is_current: boolean;
}

export interface Template {
  key: string;
  name: string;
  icon: string;
  description: string;
  blocks: DocBlock[];
}

export interface MeetingNote {
  id: string;
  title: string;
  updated_at: string;
  created_by: DocPerson | null;
  actions: number;
  tasks: number;
}

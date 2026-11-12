/**
 * What the component documentation documents, and in what order (§60).
 *
 * The *demos* are files (see `sources.ts`), so their code cannot drift from
 * what they show. What is written here is the prose around them — the purpose,
 * when to reach for it, and the props — and the props are checked against the
 * component's own source by `registry.test.ts`, so a renamed prop fails a test
 * rather than leaving a table that lies.
 */

export type DocGroup =
  | "Foundations"
  | "Layout"
  | "Navigation"
  | "Data display"
  | "Data entry"
  | "Feedback"
  | "Charts"
  | "Overlays"
  | "Nucleus patterns";

export const GROUPS: DocGroup[] = [
  "Foundations",
  "Layout",
  "Navigation",
  "Data display",
  "Data entry",
  "Feedback",
  "Charts",
  "Overlays",
  "Nucleus patterns",
];

export interface PropDoc {
  name: string;
  type: string;
  default?: string;
  description: string;
}

export interface DocEntry {
  id: string;
  name: string;
  group: DocGroup;
  /** One line: what it is for. */
  purpose: string;
  /** When to reach for it — and, where it matters, when not to. */
  when: string[];
  /** Demo file names in `./demos`, without `.tsx`. */
  demos: { id: string; title: string; note?: string }[];
  /** How to bring it in. */
  importLine: string;
  api?: PropDoc[];
  /** The shared component file this documents, for the coverage count and the props check. */
  component?: string;
}

export const ENTRIES: DocEntry[] = [
  // ── Foundations ─────────────────────────────────────────────────────────
  {
    id: "colours",
    name: "Colour tokens",
    group: "Foundations",
    purpose: "Every colour is a CSS custom property that follows light and dark — never a hex in a page.",
    when: [
      "Reach for a variable, e.g. `var(--nu-accent)` or `rgba(var(--nu-ink-rgb), 0.06)` for a soft fill.",
      "A hex outside `src/theme` fails `palette.test.ts`; add a token there instead.",
    ],
    demos: [{ id: "tokens.colours", title: "Swatches", note: "Switch the stage to Dark to see the same names resolve differently." }],
    importLine: 'import { SEMANTIC, SERIES, ACCENT } from "@/theme/tokens";',
  },
  {
    id: "type",
    name: "Type scale",
    group: "Foundations",
    purpose: "One typeface — Inter — from page titles to captions; headings are heavy and tightly tracked.",
    when: [
      "Page titles come from PageHeader; the emphasised word is an `<em>` in the accent, upright.",
      "Numbers that line up (KPIs, tables) use tabular figures.",
    ],
    demos: [{ id: "tokens.type", title: "The scale" }],
    importLine: 'import { FONT } from "@/theme/tokens";',
  },
  {
    id: "shape",
    name: "Radii & shadows",
    group: "Foundations",
    purpose: "Soft corners that grow with the surface, and shadows that lift rather than outline.",
    when: ["Controls are pills; cards 28; modals 30. A hovered row lifts with `--nu-lift`."],
    demos: [{ id: "tokens.shape", title: "Radii and elevation" }],
    importLine: 'import { RADIUS, SHADOW } from "@/theme/tokens";',
  },
  {
    id: "density",
    name: "Density",
    group: "Foundations",
    purpose: "Compact, Normal and Relaxed scale text and controls together, per account.",
    when: ["Never set a component size to get density — it is the reader's choice, and the theme applies it."],
    demos: [{ id: "tokens.density", title: "Try each density" }],
    importLine: 'import { useAppearance } from "@/theme/AppearanceProvider";',
  },
  {
    id: "icons",
    name: "NxIcon",
    group: "Foundations",
    purpose: "The design's stroke icons, drawn at the current text colour.",
    when: ["Navigation, icon tiles and toolbar glyphs. Click an icon to copy its JSX."],
    demos: [{ id: "icons.gallery", title: "Icon gallery", note: "Click to copy." }],
    importLine: 'import { NxIcon, NxLogo } from "@/components/NxIcon";',
    component: "NxIcon",
    api: [
      { name: "name", type: "NxIconName", description: "Which icon — one of the keys of NX_ICONS." },
      { name: "size", type: "number", default: "18", description: "Width and height in pixels." },
      { name: "stroke", type: "number", default: "1.9", description: "Stroke width." },
      { name: "className", type: "string", description: "Extra class on the svg." },
      { name: "style", type: "CSSProperties", description: "Inline style on the svg." },
    ],
  },

  // ── Layout ─────────────────────────────────────────────────────────────
  {
    id: "page-header",
    name: "PageHeader",
    group: "Layout",
    purpose: "The one header every page has: title, one line of context, actions on the right.",
    when: [
      "At the top of every routed page — exactly once.",
      "Put one primary action last in `actions`; secondary verbs before it.",
      "A drill-down's way back is added automatically from `?from=`.",
    ],
    demos: [
      { id: "page-header.basic", title: "List page", note: "Emphasised word, secondary and primary action." },
      { id: "page-header.detail", title: "Detail page", note: "Back button, status tags beside the title." },
    ],
    importLine: 'import { PageHeader } from "@/components/PageHeader";',
    component: "PageHeader",
    api: [
      { name: "title", type: "ReactNode", description: "The page's name. Wrap one word in <em> for the accent." },
      { name: "subtitle", type: "ReactNode", description: "One line of context: counts, scope, freshness." },
      { name: "actions", type: "ReactNode", description: "Buttons on the right; the primary one last." },
      { name: "tag", type: "ReactNode", description: "A status or count that belongs beside the title." },
      { name: "onBack", type: "() => void", description: "Shows a back button before the title." },
    ],
  },
  {
    id: "glass",
    name: "Glass panel",
    group: "Layout",
    purpose: "The frosted surface every panel, bar and sheet is built from.",
    when: ["Use a Card for a titled panel; `.nx-glass` for a bare surface you compose yourself."],
    demos: [{ id: "glass-panel.basic", title: ".nx-glass and .nx-glass--strong" }],
    importLine: '<div className="nx-glass">…</div>',
  },
  {
    id: "card",
    name: "Card",
    group: "Layout",
    purpose: "A titled glass panel. Nested cards become soft fills rather than panels on panels.",
    when: ["Group one subject on a page. Prefer one card with sections over many tiny cards."],
    demos: [{ id: "card.basic", title: "Card and inner card" }],
    importLine: 'import { Card } from "antd";',
  },

  // ── Navigation ─────────────────────────────────────────────────────────
  {
    id: "tabs",
    name: "Tabs",
    group: "Navigation",
    purpose: "Switch between views of one subject; keep the chosen tab in the address.",
    when: ["Pill tabs (`className=\"nx-ad-tabs\"`) under a page header; line tabs inside a card."],
    demos: [
      { id: "tabs.pill", title: "Pill tabs" },
      { id: "tabs.line", title: "Line tabs", note: "With a disabled tab." },
    ],
    importLine: 'import { Tabs } from "antd";',
  },
  {
    id: "segmented",
    name: "Segmented",
    group: "Navigation",
    purpose: "Choose one of a few — a period, a view, a mode.",
    when: ["Two to six options that are all worth seeing. More than that is a Select.", "Never a strip of radio buttons."],
    demos: [
      { id: "segmented.basic", title: "Windows", note: "With a disabled option." },
      { id: "segmented.icons", title: "Icons, small and block" },
    ],
    importLine: 'import { Segmented } from "antd";',
  },
  {
    id: "steps",
    name: "Steps",
    group: "Navigation",
    purpose: "Where a wizard is, and what is left.",
    when: ["A task with an order that cannot be skipped (import, onboarding). Not for tabs."],
    demos: [
      { id: "steps.wizard", title: "Wizard", note: "Back and Continue drive it." },
      { id: "steps.vertical", title: "Vertical with an error" },
    ],
    importLine: 'import { Steps } from "antd";',
  },
  {
    id: "dropdown",
    name: "Dropdown menu",
    group: "Navigation",
    purpose: "More actions than fit, behind one control.",
    when: ["Row actions beyond the first; destructive items last, marked danger."],
    demos: [{ id: "dropdown.menu", title: "Menu and an icon trigger" }],
    importLine: 'import { Dropdown } from "antd";',
  },
  {
    id: "pagination",
    name: "Pagination",
    group: "Navigation",
    purpose: "Pages of a server-side list; the active page is an ink pill.",
    when: ["Under every table that pages on the server. The total counts the whole dataset."],
    demos: [{ id: "pagination.basic", title: "Full and simple" }],
    importLine: 'import { Pagination } from "antd";',
  },

  // ── Data display ───────────────────────────────────────────────────────
  {
    id: "stat-card",
    name: "StatCard",
    group: "Data display",
    purpose: "One number, how it moved, and whether that movement is good news.",
    when: [
      "KPI rows on dashboards and list pages.",
      "Set `polarity`: a rise is good for revenue and bad for response time.",
      "Give it `onClick` when the number opens the rows behind it.",
    ],
    demos: [
      { id: "stat-card.polarity", title: "Polarity", note: "The same arrow, good and bad." },
      { id: "stat-card.states", title: "Flat, clickable, no comparison" },
    ],
    importLine: 'import { StatCard } from "@/components/StatCard";',
    component: "StatCard",
    api: [
      { name: "label", type: "string", description: "What is counted." },
      { name: "value", type: "number", description: "The number." },
      { name: "displayValue", type: "string", description: "Overrides how the value is written." },
      { name: "unit", type: "string", description: "EUR / USD / GBP format as money, compact above a million." },
      { name: "icon", type: "ReactNode", description: "Shown on a tinted tile." },
      { name: "accent", type: '"accent" | "success" | "warning" | "danger" | "info" | "neutral"', default: '"accent"', description: "The tile's colour." },
      { name: "hint", type: "ReactNode", description: "One line under the number." },
      { name: "trend", type: '"up" | "down" | "flat"', description: "Which way it moved." },
      { name: "polarity", type: '"up_is_good" | "down_is_good" | "neutral"', description: "Whether up is good news." },
      { name: "changePercent", type: "number", description: "The size of the move." },
      { name: "previous", type: "number", description: "The previous period's value." },
      { name: "onClick", type: "() => void", description: "Makes the card a button that drills down." },
    ],
  },
  {
    id: "status-tag",
    name: "StatusTag",
    group: "Data display",
    purpose: "A status as a pill with a dot, one colour per meaning across every vocabulary.",
    when: [
      "Any status, state or level from the API — pass the raw value; it is humanised for reading.",
      "Never a Tag with a computed colour: `StatusTag.test.tsx` refuses it.",
    ],
    demos: [
      { id: "status-tag.tones", title: "All five tones" },
      { id: "status-tag.vocabulary", title: "The vocabulary", note: "Raw API values, read as words." },
    ],
    importLine: 'import { StatusTag } from "@/components/StatusTag";',
    component: "StatusTag",
    api: [
      { name: "status", type: "string | null", description: "The vocabulary value — OPEN, AT_RISK, DELIVERED." },
      { name: "label", type: "ReactNode", description: "Overrides the readable label." },
      { name: "tone", type: '"ok" | "warn" | "bad" | "acc" | "neutral"', description: "Overrides the vocabulary's tone." },
      { name: "bordered", type: "boolean", description: "Kept for old callers; the pill has no border." },
    ],
  },
  {
    id: "edge-tag",
    name: "EdgeTag",
    group: "Data display",
    purpose: "A chip whose colour is data — a role's, a widget kind's — drawn so the label stays readable.",
    when: ["The colour comes from the API rather than a vocabulary. For statuses use StatusTag."],
    demos: [{ id: "edge-tag.colours", title: "Roles", note: "And one with no colour assigned." }],
    importLine: 'import { EdgeTag } from "@/components/EdgeTag";',
    component: "EdgeTag",
    api: [
      { name: "color", type: "string | null", description: "The colour this chip means — a hex from the API or a token." },
      { name: "bordered", type: "boolean", default: "true", description: "Kept for old callers." },
      { name: "children", type: "ReactNode", description: "The label." },
      { name: "style", type: "CSSProperties", description: "Inline style." },
    ],
  },
  {
    id: "tag",
    name: "Tag",
    group: "Data display",
    purpose: "A soft label: a kind, a category, a count.",
    when: ["Free-form labels. For a status use StatusTag; for data-coloured chips EdgeTag."],
    demos: [{ id: "tag.basic", title: "Colours, icons, closable" }],
    importLine: 'import { Tag } from "antd";',
  },
  {
    id: "badge",
    name: "Badge",
    group: "Data display",
    purpose: "A count or a dot on something, or a status beside a word.",
    when: ["Unread counts on icons; live/degraded/down beside a name."],
    demos: [{ id: "badge.basic", title: "Counts, dots and statuses" }],
    importLine: 'import { Badge } from "antd";',
  },
  {
    id: "person-avatar",
    name: "PersonAvatar",
    group: "Data display",
    purpose: "A face, or initials when there is none — named only when it is the only thing naming someone.",
    when: ["Beside a person's name (decorative), or alone with `label` (then it is named)."],
    demos: [{ id: "person-avatar.basic", title: "Sizes, labelled, empty and a group" }],
    importLine: 'import { PersonAvatar } from "@/components/PersonAvatar";',
    component: "PersonAvatar",
    api: [
      { name: "initials", type: "string | null", description: "Shown when there is no picture." },
      { name: "src", type: "string | null", description: "The picture." },
      { name: "name", type: "string | null", description: "Used as the accessible name when `label` is set." },
      { name: "label", type: "boolean", description: "Set when the avatar alone identifies the person." },
      { name: "size", type: '"small" | "default" | "large" | number', description: "From AntD's Avatar." },
    ],
  },
  {
    id: "table",
    name: "Table",
    group: "Data display",
    purpose: "Every list: rows are soft pills on a glass panel, the header is small caps.",
    when: [
      "Server-side lists — filtering, sorting and paging happen in SQL; the header counts the dataset.",
      "Show the right empty: nothing yet (an action) is not nothing matched (clear filters).",
      "Name every selection checkbox; show the bulk bar only while something is selected.",
    ],
    demos: [
      { id: "table.glass-rows", title: "Glass rows" },
      { id: "table.selection-bulk", title: "Selection and the bulk bar" },
      { id: "table.states", title: "Six states", note: "Rows, loading, two empties, failed, refused." },
    ],
    importLine: 'import { Table } from "antd";',
  },
  {
    id: "timeline",
    name: "Feed & timeline",
    group: "Data display",
    purpose: "What happened, in order — grouped by day so the eye finds the boundary.",
    when: ["Activity feeds, a record's history, a ticket's handling."],
    demos: [
      { id: "timeline.feed", title: "Feed rows" },
      { id: "timeline.antd", title: "Timeline" },
    ],
    importLine: 'import { Timeline } from "antd";',
  },
  {
    id: "descriptions",
    name: "Descriptions",
    group: "Data display",
    purpose: "Label–value pairs for a record's facts.",
    when: ["A side panel of facts. More than a dozen is a form or a table."],
    demos: [{ id: "descriptions.basic", title: "Bordered" }],
    importLine: 'import { Descriptions } from "antd";',
  },
  {
    id: "highlighted-text",
    name: "HighlightedText",
    group: "Data display",
    purpose: "Marks the term that was searched for, and nothing when the term is empty.",
    when: ["Search results and filtered lists."],
    demos: [{ id: "highlighted-text.basic", title: "Match, no term, no match" }],
    importLine: 'import { HighlightedText } from "@/components/HighlightedText";',
    component: "HighlightedText",
    api: [
      { name: "text", type: "string", description: "The text to show." },
      { name: "term", type: "string", description: "What to mark." },
    ],
  },

  // ── Data entry ─────────────────────────────────────────────────────────
  {
    id: "button",
    name: "Button",
    group: "Data entry",
    purpose: "Four roles, one spelling each: primary, secondary, quiet and destructive.",
    when: [
      "One primary per surface. Navigation is a Link, never a button calling navigate.",
      "An icon-only button carries an aria-label naming the verb and its object.",
      "No size prop — density is the reader's choice.",
    ],
    demos: [
      { id: "button.vocabulary", title: "The vocabulary" },
      { id: "button.states", title: "Loading, disabled, icon, block" },
    ],
    importLine: 'import { Button } from "antd";',
  },
  {
    id: "input",
    name: "Input",
    group: "Data entry",
    purpose: "Pill fields on a white well; a focus ring in the accent.",
    when: ["Every free-text field. Use `status` for a validation result, not a red label alone."],
    demos: [{ id: "input.pill", title: "States and kinds" }],
    importLine: 'import { Input, InputNumber } from "antd";',
  },
  {
    id: "select",
    name: "Select",
    group: "Data entry",
    purpose: "Choose from a list too long to show.",
    when: ["More than six options, or options from the server. On a filter bar the placeholder says \"X: any\"."],
    demos: [{ id: "select.basic", title: "Single, multiple, search, loading, disabled, error" }],
    importLine: 'import { Select } from "antd";',
  },
  {
    id: "date-picker",
    name: "Date pickers",
    group: "Data entry",
    purpose: "Dates, ranges, months and times in the reader's own format.",
    when: ["Due dates, windows, schedules."],
    demos: [{ id: "date-picker.basic", title: "Date, range, month, time" }],
    importLine: 'import { DatePicker, TimePicker } from "antd";',
  },
  {
    id: "selection",
    name: "Checkbox, radio, switch, slider",
    group: "Data entry",
    purpose: "Yes/no and some-of-many choices.",
    when: ["A switch acts immediately; a checkbox is part of a form that is saved."],
    demos: [{ id: "selection.controls", title: "All four" }],
    importLine: 'import { Checkbox, Radio, Switch, Slider } from "antd";',
  },
  {
    id: "form",
    name: "Form",
    group: "Data entry",
    purpose: "Vertical labels, validation in words, the submit last.",
    when: ["Any create or edit; two columns on desktop, one on phone."],
    demos: [{ id: "form.basic", title: "Validated form", note: "Submit it empty." }],
    importLine: 'import { Form } from "antd";',
  },
  {
    id: "people-picker",
    name: "PeoplePicker",
    group: "Data entry",
    purpose: "Choose colleagues, searched on the server.",
    when: ["Assignees, shares, members. The list is never filtered again in the browser."],
    demos: [{ id: "people-picker.basic", title: "Search the directory" }],
    importLine: 'import { PeoplePicker } from "@/components/PeoplePicker";',
    component: "PeoplePicker",
    api: [
      { name: "value", type: "string[] | string", description: "Chosen user ids." },
      { name: "onChange", type: "(value) => void", description: "Called with the new selection." },
      { name: "known", type: "Person[]", default: "[]", description: "People already known, so chosen ones render by name." },
      { name: "multiple", type: "boolean", default: "true", description: "Several or one." },
      { name: "placeholder", type: "string", description: "Prompt in the field." },
      { name: "disabled", type: "boolean", description: "Refuses input." },
      { name: "exclude", type: "string[]", default: "[]", description: "Ids not to offer." },
    ],
  },
  {
    id: "export-button",
    name: "ExportButton",
    group: "Data entry",
    purpose: "Export what is on screen in a chosen format, or queue a large one.",
    when: ["Beside every list and chart that can be downloaded."],
    demos: [{ id: "export-button.basic", title: "Default, queued, disabled" }],
    importLine: 'import { ExportButton } from "@/components/ExportButton";',
    component: "ExportButton",
    api: [
      { name: "onExport", type: "(format) => Promise<void>", description: "Exports synchronously." },
      { name: "onQueue", type: "(format) => Promise<void>", description: "Queues a background export for a large set." },
      { name: "disabled", type: "boolean", description: "Nothing to export." },
      { name: "label", type: "string", default: '"Export"', description: "The button's word." },
      { name: "size", type: '"small" | "middle" | "large"', description: "Dense by construction inside toolbars." },
    ],
  },

  // ── Feedback ───────────────────────────────────────────────────────────
  {
    id: "empty-state",
    name: "EmptyState",
    group: "Feedback",
    purpose: "Nothing here — and either the action that makes the first one, or the filters to clear.",
    when: ["Every empty list, card or table. Never AntD's Empty.", "NoResults when a filter is the reason."],
    demos: [{ id: "empty-state.shapes", title: "The shapes" }],
    importLine: 'import { EmptyState, NoResults } from "@/components/EmptyState";',
    component: "EmptyState",
    api: [
      { name: "title", type: "ReactNode", description: "What is missing." },
      { name: "hint", type: "ReactNode", description: "Why, or what would fill it." },
      { name: "icon", type: "ReactNode", description: "Replaces the default glyph." },
      { name: "action", type: "ReactNode", description: "A Button, usually primary." },
      { name: "compact", type: "boolean", description: "Smaller, for a card or a cell." },
    ],
  },
  {
    id: "failure-alert",
    name: "FailureAlert",
    group: "Feedback",
    purpose: "Why a view failed, the id to quote, and a retry only where trying again could work.",
    when: ["Every data view's error state. A refusal names the permission and offers no retry."],
    demos: [{ id: "failure-alert.kinds", title: "500, 403, 404, 409" }],
    importLine: 'import { FailureAlert } from "@/components/FailureAlert";',
    component: "FailureAlert",
    api: [
      { name: "error", type: "unknown", description: "What the query threw — an ApiError is read for its kind." },
      { name: "titles", type: "Partial<Record<FailureKind, ReactNode>>", description: "A sentence per kind." },
      { name: "hints", type: "Partial<Record<FailureKind, ReactNode>>", description: "A second line per kind." },
      { name: "onRetry", type: "() => void", description: "Shown only for kinds a retry can fix." },
      { name: "action", type: "ReactNode", description: "Another way forward." },
      { name: "className", type: "string", description: "Extra class." },
    ],
  },
  {
    id: "alert",
    name: "Alert",
    group: "Feedback",
    purpose: "A notice that belongs to the page: soft, round, with an icon.",
    when: ["Something the reader should know before acting. Not for results of an action — that is a message."],
    demos: [{ id: "alert.tones", title: "Info, success, warning, error" }],
    importLine: 'import { Alert } from "antd";',
  },
  {
    id: "toasts",
    name: "Messages, notifications, confirm",
    group: "Feedback",
    purpose: "The result of an action, a background event, and a question before a destructive one.",
    when: ["`App.useApp()` for all three, so they pick up the theme."],
    demos: [{ id: "feedback.toasts", title: "Fire one" }],
    importLine: 'import { App } from "antd";',
  },
  {
    id: "progress",
    name: "Progress",
    group: "Feedback",
    purpose: "How far a long job has got.",
    when: ["Exports, imports, rollouts. Always named with aria-label."],
    demos: [{ id: "progress.basic", title: "Line, circle, steps" }],
    importLine: 'import { Progress } from "antd";',
  },
  {
    id: "skeleton",
    name: "Skeleton & spin",
    group: "Feedback",
    purpose: "Loading in the final layout — a skeleton says what is about to be there.",
    when: ["Prefer a skeleton to a centred spinner on first load."],
    demos: [{ id: "skeleton.basic", title: "Skeletons and a spinner" }],
    importLine: 'import { Skeleton, Spin } from "antd";',
  },
  {
    id: "auto-refresh",
    name: "AutoRefresh",
    group: "Feedback",
    purpose: "How old the page is, and how often to ask again.",
    when: ["Operational pages people leave open: jobs, logs, dashboards."],
    demos: [{ id: "auto-refresh.basic", title: "Split control" }],
    importLine: 'import { AutoRefresh } from "@/components/AutoRefresh";',
    component: "AutoRefresh",
    api: [
      { name: "page", type: "string", description: "Key the chosen interval is remembered under." },
      { name: "refresh", type: "() => void", description: "Asks again." },
      { name: "updatedAt", type: "number", description: "When the data was fetched (ms)." },
      { name: "busy", type: "boolean", description: "A request is in flight." },
      { name: "defaultSeconds", type: "RefreshSeconds", description: "The interval until the reader picks one." },
    ],
  },
  {
    id: "problem-page",
    name: "ProblemPage",
    group: "Feedback",
    purpose: "The full-page answer when a page cannot be shown at all.",
    when: ["Routing failures and whole-page refusals. Each kind is its own address."],
    demos: [{ id: "problem-page.kinds", title: "Every kind, by address" }],
    importLine: 'import { ProblemPage } from "@/components/ProblemPage";',
    component: "ProblemPage",
    api: [
      { name: "kind", type: "ProblemKind", description: "not_found, forbidden, failed, offline, …" },
      { name: "correlationId", type: "string", description: "The failed request's id." },
      { name: "missing", type: "string[]", default: "[]", description: "Permissions named for forbidden." },
      { name: "detail", type: "ReactNode", description: "More about what happened." },
      { name: "onRetry", type: "() => void", description: "Offered where a retry can work." },
      { name: "onSignIn", type: "() => void", description: "Offered when the session ended." },
      { name: "standalone", type: "boolean", default: "false", description: "Drawn without the shell." },
    ],
  },

  // ── Charts ─────────────────────────────────────────────────────────────
  {
    id: "chart-card",
    name: "ChartCard",
    group: "Charts",
    purpose: "A chart that can always be read as a table, exported, and that says when its query failed.",
    when: ["Every dashboard and analytics panel."],
    demos: [
      { id: "chart-card.bar", title: "A bar panel", note: "Toggle chart / table in its header." },
      { id: "chart-card.states", title: "Loading, empty, failed" },
    ],
    importLine: 'import { ChartCard } from "@/components/ChartCard";',
    component: "ChartCard",
    api: [
      { name: "id", type: "string", description: "Remembers chart or table view per panel." },
      { name: "panel", type: "ChartPanel | undefined", description: "Kind, title and series from the API." },
      { name: "height", type: "number | string", description: "The chart's height." },
      { name: "extra", type: "ReactNode", description: "Controls in the header." },
      { name: "onSelect", type: "(name) => void", description: "A mark was clicked — drill down." },
      { name: "loading", type: "boolean", description: "Draws a skeleton." },
      { name: "error", type: "unknown", description: "Draws a FailureAlert instead of an empty chart." },
      { name: "onRetry", type: "() => void", description: "Retry for the failure." },
      { name: "empty", type: "{ title; hint? }", description: "What an empty series says." },
      { name: "className", type: "string", description: "Extra class." },
    ],
  },
  {
    id: "chart-preview",
    name: "ChartPreview & kind strip",
    group: "Charts",
    purpose: "A chart without chrome, in a theme it is told to use; and the strip that picks its kind.",
    when: ["Builders and thumbnails. Check both modes — half the readers are in the other one."],
    demos: [{ id: "chart-preview.kinds", title: "Pick a kind, drawn light and dark" }],
    importLine: 'import { ChartPreview } from "@/components/charts/ChartPreview";',
  },
  {
    id: "latency-chart",
    name: "Time-series sparkline",
    group: "Charts",
    purpose: "A value over real time: a quiet sparkline on a card, a full axis in the detail.",
    when: ["Anything sampled over time. Use a time axis — a category axis smears dates."],
    demos: [{ id: "chart.latency", title: "Sparkline and detailed" }],
    importLine: 'import { LatencyChart } from "@/components/health/LatencyChart";',
  },

  // ── Overlays ───────────────────────────────────────────────────────────
  {
    id: "modal",
    name: "Modal",
    group: "Overlays",
    purpose: "A frosted sheet for one decision; owns its own primary.",
    when: ["A short form or a confirmation. Esc, the X and a click outside all close it, and so does Back."],
    demos: [{ id: "modal.basic", title: "A modal with a form" }],
    importLine: 'import { Modal } from "antd";',
  },
  {
    id: "name-modal",
    name: "NameModal",
    group: "Overlays",
    purpose: "The plain modal for a create whose whole decision is one word.",
    when: ["New folder, new board, rename. Enter submits; empty is refused in words."],
    demos: [{ id: "name-modal.basic", title: "Name a folder" }],
    importLine: 'import { NameModal } from "@/components/NameModal";',
    component: "NameModal",
    api: [
      { name: "open", type: "boolean", description: "Shown or not." },
      { name: "title", type: "string", description: "The modal's title." },
      { name: "label", type: "string", description: "The field's label." },
      { name: "placeholder", type: "string", description: "An example name." },
      { name: "initial", type: "string", description: "The current name, for a rename." },
      { name: "okText", type: "string", description: "The confirm word." },
      { name: "saving", type: "boolean", description: "The submit is in flight." },
      { name: "onClose", type: "() => void", description: "Closed without a name." },
      { name: "onSubmit", type: "(name) => void", description: "The trimmed name." },
    ],
  },
  {
    id: "drawer",
    name: "Drawer",
    group: "Overlays",
    purpose: "A record's detail beside the list it came from.",
    when: ["Inspect or edit one row without losing the list's place. A full screen on phone."],
    demos: [{ id: "drawer.basic", title: "A job in a drawer" }],
    importLine: 'import { Drawer } from "antd";',
  },
  {
    id: "popovers",
    name: "Tooltip, popover, popconfirm",
    group: "Overlays",
    purpose: "A little more, on hover or click — and a question before a risky press.",
    when: ["Exact times and abbreviations in tooltips; never put the only copy of a fact in one."],
    demos: [{ id: "overlay.tooltip-popover", title: "All three" }],
    importLine: 'import { Tooltip, Popover, Popconfirm } from "antd";',
  },
  {
    id: "command-palette",
    name: "CommandPalette",
    group: "Overlays",
    purpose: "Every action on the page, by name, from ⌘K.",
    when: ["Register page actions with `usePageCommands`; the shell mounts the palette."],
    demos: [{ id: "command-palette.open", title: "Open it" }],
    importLine: 'import { usePageCommands } from "@/commands/CommandContext";',
    component: "CommandPalette",
  },

  // ── Nucleus patterns ───────────────────────────────────────────────────
  {
    id: "filter-bar",
    name: "Search bar & quick filters",
    group: "Nucleus patterns",
    purpose: "A glass bar of filled pills over a list, and chips with a dot, a label and a count.",
    when: ["Above every list. A chosen filter turns ink; chip counts come from the server's facets."],
    demos: [{ id: "filter-bar.pills", title: "Bar and chips" }],
    importLine: '<div className="nx-ad-bar">…</div> · <div className="nx-ad-segs">…</div>',
  },
  {
    id: "kpi-tile",
    name: "KPI tiles",
    group: "Nucleus patterns",
    purpose: "Plain counts in glass tiles, when there is no trend to show.",
    when: ["Summaries above a findings list. With a trend, use StatCard."],
    demos: [{ id: "kpi-tile.admin", title: "Three tiles" }],
    importLine: '<div className="nx-ad-tiles"><div className="nx-ad-tile">…</div></div>',
  },
  {
    id: "area-map",
    name: "Area map card",
    group: "Nucleus patterns",
    purpose: "A link card with an icon tile, a title, a badge and what the place is for.",
    when: ["Index pages that are maps of an area."],
    demos: [{ id: "admin-map.card", title: "Area cards" }],
    importLine: '<nav className="nx-ad-map"><Link className="nx-ad-mapcard">…</Link></nav>',
  },
  {
    id: "widget-card",
    name: "WidgetCard",
    group: "Nucleus patterns",
    purpose: "A dashboard tile: the frame, edit controls while rearranging, a scrolling body.",
    when: ["Custom dashboards."],
    demos: [{ id: "widget-card.modes", title: "Reading and rearranging" }],
    importLine: 'import { WidgetCard } from "@/components/dashboards/WidgetCard";',
  },
  {
    id: "kanban-card",
    name: "KanbanCardTile",
    group: "Nucleus patterns",
    purpose: "A board card that shows only the facts that are there.",
    when: ["Boards. The kind is an edge, not a tinted card."],
    demos: [{ id: "kanban-card.tile", title: "A card" }],
    importLine: 'import { KanbanCardTile } from "@/components/kanban/KanbanCardTile";',
  },
  {
    id: "tag-chip",
    name: "TagChip",
    group: "Nucleus patterns",
    purpose: "A record tag, coloured on its edge, linking to the records that carry it.",
    when: ["Tag lists on records."],
    demos: [{ id: "tag-chip.basic", title: "Three categories" }],
    importLine: 'import { TagChip } from "@/components/records/TagPicker";',
  },
  {
    id: "audit-diff",
    name: "AuditDiff",
    group: "Nucleus patterns",
    purpose: "What one change changed, field by field.",
    when: ["Audit log rows and record history."],
    demos: [{ id: "audit-diff.basic", title: "Changed, added, cleared" }],
    importLine: 'import { AuditDiff } from "@/components/audit/AuditDiff";',
  },
];

/** The shared components this documentation demonstrates, for the coverage count. */
export const DOCUMENTED_COMPONENTS: string[] = ENTRIES.flatMap((entry) => (entry.component ? [entry.component] : []));

/** Lower-case words an entry can be found by. */
export function searchText(entry: DocEntry): string {
  return [entry.name, entry.group, entry.purpose, ...entry.when, ...entry.demos.map((demo) => demo.title)]
    .join(" ")
    .toLowerCase();
}

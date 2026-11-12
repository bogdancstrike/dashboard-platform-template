/**
 * The starter page templates (§61) — each a file in `./templates`, rendered
 * live as its own thumbnail and shown as its own code, so the picture, the
 * skeleton and the copy are one thing.
 */

export interface StarterTemplate {
  id: string;
  name: string;
  /** When this is the right page to start from. */
  when: string;
  /** What it is built from. */
  pieces: string[];
  /** A real page built this way, to open. */
  example?: string;
}

export const STARTERS: StarterTemplate[] = [
  { id: "list-page", name: "List page", when: "A collection people search, filter and page through — the most common page in the product.", pieces: ["PageHeader", "Search bar", "Table", "StatusTag"], example: "/admin/users" },
  { id: "detail-page", name: "Detail page", when: "One record: its facts beside its conversation or history, with the verbs in the header.", pieces: ["PageHeader + onBack", "Tabs", "Descriptions"], example: "/tickets" },
  { id: "dashboard", name: "Dashboard", when: "Numbers someone checks every morning, compared with the period before.", pieces: ["StatCard", "ChartCard", "Segmented"], example: "/dashboard" },
  { id: "settings", name: "Settings", when: "Configuration in titled sections, saved together.", pieces: ["Card sections", "Form", "Switch"], example: "/admin/settings" },
  { id: "wizard", name: "Wizard", when: "A task with an order that cannot be skipped, like an import.", pieces: ["Steps", "Card", "Select"], example: "/import" },
  { id: "feed", name: "Feed", when: "What happened, grouped by day so the boundary is easy to find.", pieces: ["Day cards", "Feed rows", "PersonAvatar"], example: "/activity" },
  { id: "board", name: "Board", when: "Work moving through columns with limits.", pieces: ["Lane cards", "Card tiles"], example: "/kanban" },
  { id: "split-view", name: "Split list / detail", when: "Working through a queue: the next item is always one click away.", pieces: ["Queue card", "Detail card"], example: "/tickets" },
  { id: "form-page", name: "Form page", when: "A create too big for a modal, with a way back.", pieces: ["PageHeader + onBack", "Form in two columns"], example: "/reports/builder" },
  { id: "area-index", name: "Area index", when: "A map of an area: where things are and what each is for.", pieces: ["Area map cards", "NxIcon tiles"], example: "/admin" },
  { id: "search-results", name: "Search results", when: "One box across every record type, results ranked and highlighted.", pieces: ["Search bar", "HighlightedText"], example: "/find/global" },
  { id: "compare", name: "Compare", when: "Two or three records side by side, differences marked.", pieces: ["Table with a row per field"], example: "/compare" },
  { id: "empty-page", name: "Empty state", when: "The first visit: nothing yet, and the action that makes the first one.", pieces: ["EmptyState", "Primary button"], example: "/dashboards" },
  { id: "error-page", name: "Error state", when: "The data could not be loaded: what failed, the id to quote, a retry.", pieces: ["FailureAlert"], example: "/errors/500" },
];

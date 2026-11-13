import type { PageLayout } from "./types";

/** Lists, split views, matrices, boards and grids: pages that show many things. */
export const COLLECTION_LAYOUTS: readonly PageLayout[] = [
  {
    key: "list",
    name: "Filtered list",
    shape:
      "A header with a live count, facets that narrow in SQL, and one table that owns its URL.",
    when:
      "The reader is looking for a record among many and knows roughly what they want.",
    unless:
      "The work is *working through* the rows rather than finding one — then a split view keeps the queue in sight.",
    wireframe: [
      [{ label: "Header · count · export", span: 12 }],
      [{ label: "Facets", span: 3 }, { label: "Search", span: 9 }],
      [{ label: "Table — the answer", span: 12, primary: true }],
      [{ label: "Pagination", span: 12 }],
    ],
    pieces: [
      "useEntityView",
      "EntityChrome (header, filters, metrics)",
      "ExplorerResults",
      "useBulk",
      "ExportButton",
    ],
    url: "The dataset, the search, every filter, the sort, the page and the page size — so a colleague opening the link sees the same rows.",
    routes: [
      // The entity lists, each shaped for what its readers actually do with
      // it: a portfolio, a ledger, a fleet, a directory. Same layout, and the
      // page's own summary and columns are what differ (§7).
      "projects",
      "customers",
      "orders",
      "devices",
      "tasks",
      "files",
      "announcements",
      "notifications",
      "activity",
      "exports",
      "admin/users",
      "admin/audit",
      "admin/logs",
      "admin/jobs",
      "admin/groups",
      "admin/organizations",
      "admin/api",
      "admin/integrations",
      "admin/flags",
      "admin/tags",
      "favorites",
      // The decision and time pages are queues and ledgers read row by row.
      "time",
      "approvals",
      "admin/sla",
      "admin/forms",
      // Records & analytics: a scored list, the watches, and the bulk-edit
      // grid — which is the same table with every cell editable.
      "customers/health",
      "alerts",
      "grid",
    ],
  },
  {
    key: "split",
    name: "Split view",
    shape: "A list on the left that stays put, and the selected thing on the right.",
    when:
      "Somebody is working down a queue: the next item matters as much as the current one.",
    unless:
      "The detail is wider than a half — a record with twelve sections belongs on its own page, and squeezing it makes both halves worse.",
    wireframe: [
      [{ label: "Header", span: 12 }],
      [
        { label: "Queue", span: 4, rows: 2 },
        { label: "The one being worked", span: 8, primary: true },
      ],
    ],
    pieces: ["ExplorerResults or ThreadList", "A reading pane", "RecordPreview"],
    url: "Which item is open, as well as the question the list is asking — so a link opens on the same row rather than on the top of the list.",
    // `/tickets` is the split one of the entity pages, deliberately: working a
    // support queue means the next ticket matters as much as the current one
    // (§62, §63), which is not true of a customer directory.
    routes: [
      "mail",
      "explore",
      "tickets",
      "developers",
      // A conversation list beside the open conversation; a page tree beside
      // the open page; a collection beside the questions asked of it.
      "assistant",
      "chat",
      "docs",
      "ai/documents",
    ],
  },
  {
    key: "matrix",
    name: "Comparison matrix",
    shape: "One row per attribute, one column per subject, and the disagreements marked.",
    when:
      "The reader is deciding *between* things, or deciding whether two of them are the same thing twice.",
    unless:
      "There is one subject — then it is a detail page, and a matrix of one column is a list of fields with extra scrolling.",
    wireframe: [
      [{ label: "Header · what is being compared", span: 12 }],
      [
        { label: "Attribute", span: 3, rows: 3 },
        { label: "Subject A", span: 3 },
        { label: "Subject B", span: 3 },
        { label: "Subject C", span: 3 },
      ],
    ],
    pieces: ["compareApi", "A pinned first column", "Disagreement marking"],
    url: "The ids being compared, in order, so the comparison is a link.",
    routes: ["compare"],
  },
  {
    key: "board",
    name: "Board",
    shape: "Columns of cards, dragged between them, with a limit per column.",
    when: "The *state* is the thing being managed and the counts per state are the point.",
    unless:
      "There are more than a few hundred cards, or the states are not a workflow — a board of nine columns is a table with extra steps.",
    wireframe: [
      [{ label: "Header · filters", span: 12 }],
      [
        { label: "Backlog", span: 3, rows: 2 },
        { label: "In progress", span: 3, rows: 2, primary: true },
        { label: "In review", span: 3, rows: 2 },
        { label: "Done", span: 3, rows: 2 },
      ],
    ],
    pieces: ["LaneColumn", "KanbanCardTile", "A drop slot", "An optimistic move"],
    url: "The board, the filters and the open card.",
    routes: ["kanban", "contracts", "sprints"],
  },
  {
    key: "grid",
    name: "Dashboard grid",
    shape: "Resizable widgets on a saved grid, arranged by whoever owns the dashboard.",
    when: "The reader is watching numbers rather than looking for a record.",
    unless:
      "Everybody needs the same three numbers — then a header of stat cards is less to build and less to get wrong.",
    wireframe: [
      [{ label: "Header", span: 12 }],
      [
        { label: "Card", span: 4 },
        { label: "Card", span: 4 },
        { label: "Card", span: 4 },
      ],
      [
        { label: "Card", span: 4 },
        { label: "Card", span: 4 },
        { label: "Card", span: 4 },
      ],
    ],
    pieces: ["A card per item", "auto-fit columns", "An empty state that offers the first one"],
    url: "Whatever narrows the gallery — a search, a category.",
    routes: ["dashboard", "dashboards", "home"],
  },
];

/**
 * The page layouts this template offers, and which pages use each (§61).
 *
 * A gallery of layouts is worth having only if it is *complete*: the question
 * somebody asks it is "what shapes does this template give me", and a gallery
 * missing two shapes answers it wrongly. So this file is one declaration —
 * every layout, and every route classified under exactly one of them — and
 * `templates.test.ts` asserts it against the router.
 *
 * That assertion is the whole design. A page added to `App.tsx` and not
 * classified here fails a test, which is the only way a gallery like this
 * stays true: the alternative is a hand-kept list that is wrong by the third
 * new page and quietly misleads everybody who reads it afterwards.
 *
 * Kept in its own module rather than in the page for two reasons: the test
 * needs it without rendering anything, and the page is then only a rendering
 * of a declaration rather than the place the declaration lives.
 */

/**
 * One region of a layout's wireframe.
 *
 * A gallery of *names* asks a reader to imagine the shape; a gallery with the
 * shape in it does not. Deliberately a structure rather than a picture: an
 * SVG or a screenshot is a second copy that drifts from the page it claims to
 * describe, and it cannot be themed, translated or read aloud. Twelve columns,
 * because that is the grid the product is built on.
 */
export interface Region {
  label: string;
  /** Columns of twelve. */
  span: number;
  /** Rows tall, for a region that runs down the side of others. */
  rows?: number;
  /** The one region that carries the answer, drawn with weight. */
  primary?: boolean;
}

/** One layout the template offers, with what it is for and what it costs. */
export interface PageLayout {
  key: string;
  name: string;
  /** What shape the reader sees. One sentence. */
  shape: string;
  /** The shape itself, as regions — so nobody has to imagine it. */
  wireframe: Region[][];
  /** The question this layout is the right answer to. */
  when: string;
  /** When it is the wrong answer — the half a gallery usually omits. */
  unless: string;
  /**
   * What it is built from.
   *
   * The question after "which shape" is always "what do I need" — and a
   * gallery that answers the first and not the second has stopped one step
   * short of being useful.
   */
  pieces: string[];
  /**
   * What it keeps in the address (§69).
   *
   * Every layout here is linkable and back-button-able, and *which* state is
   * in the URL is the decision somebody copying the layout has to make on
   * their own page.
   */
  url: string;
  /** The routes built this way. Asserted complete against the router. */
  routes: string[];
}

/**
 * Every layout, in the order a reader meets them.
 *
 * `unless` is on every one deliberately. A gallery that only says what each
 * layout is *for* invites somebody to reach for the most impressive one; the
 * useful half is knowing when a split view is worse than a table.
 */
export const LAYOUTS: PageLayout[] = [
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
    routes: ["mail", "explore", "tickets"],
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
    routes: ["kanban"],
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
  {
    key: "wizard",
    name: "Wizard",
    shape: "Numbered steps, each answering one question, with the work saved between them.",
    when:
      "The decision has parts and one form asking all of them at once gets a worse answer to each.",
    unless:
      "It is three fields. A wizard around a short form is ceremony, and somebody has to press Next twice for nothing.",
    wireframe: [
      [{ label: "Steps: 1 — 2 — 3 — review", span: 12 }],
      [{ label: "The current step", span: 12, primary: true }],
      [{ label: "Back · Next", span: 12 }],
    ],
    pieces: ["Steps", "A draft held until the last press", "A review step that is the point"],
    url: "The step, so a half-finished wizard survives a reload.",
    routes: ["import"],
  },
  {
    key: "builder",
    name: "Builder",
    shape: "A canvas of choices on one side and a live preview of the result on the other.",
    when:
      "The reader is composing something whose output they cannot picture from the inputs.",
    unless:
      "The result is obvious from the form — a preview of a name field is a second name field.",
    wireframe: [
      [{ label: "Header · save", span: 12 }],
      [{ label: "The question, as one bar", span: 12 }],
      [{ label: "The answer, live", span: 12, primary: true }],
    ],
    pieces: ["QuestionBar", "ChartCard", "The draft in the URL", "One compiler, server-side"],
    url: "The whole draft — which is what lets a half-built report be pasted to a colleague.",
    routes: ["reports/builder", "charts/builder", "workflows", "reports"],
  },
  {
    key: "canvas",
    name: "Full-height canvas",
    shape: "One thing filling the window, with the chrome out of the way.",
    when:
      "The subject is spatial — a map, a graph, a calendar — and every pixel spent on chrome is a pixel of it lost.",
    unless:
      "The reader needs the surrounding controls as often as the canvas; a map with a permanent filter panel is two panes, not a canvas.",
    wireframe: [
      [{ label: "Header · rearrange", span: 12 }],
      [
        { label: "Widget", span: 6, primary: true },
        { label: "Widget", span: 3 },
        { label: "Widget", span: 3 },
      ],
      [{ label: "Widget", span: 4 }, { label: "Widget", span: 8 }],
    ],
    pieces: ["WidgetGrid (react-grid-layout)", "WidgetCard", "One arrange endpoint"],
    url: "Which layout is open. Where the cards are belongs to the object, not the address.",
    routes: ["maps", "calendar", "find/relationships", "analytics"],
  },
  {
    key: "search",
    name: "Search results",
    shape: "One box, results grouped by what they are, and the keyboard doing the walking.",
    when: "The reader knows a word and not where it lives.",
    unless:
      "They know the dataset — then a filtered list gets them there in one step instead of two.",
    wireframe: [
      [{ label: "One field", span: 12, primary: true }],
      [{ label: "Grouped results", span: 12 }],
    ],
    pieces: ["One endpoint across datasets", "Result grouping", "Keyboard navigation"],
    url: "The term, so a search is a link.",
    routes: ["search", "search/saved", "find/global", "find/catalog"],
  },
  {
    key: "settings",
    name: "Settings form",
    shape:
      "Grouped controls rendered from declarations, each saved on its own and each saying what it affects.",
    when: "Every control is independent and the reader came to change one of them.",
    unless:
      "The changes are interdependent — then it is a form with one Save, because half-applied settings are worse than a slower save.",
    wireframe: [
      [{ label: "Header", span: 12 }],
      [{ label: "Card of settings", span: 6 }, { label: "Card of settings", span: 6 }],
      [{ label: "Card of settings", span: 6 }, { label: "Card of settings", span: 6 }],
    ],
    pieces: ["One control per decision", "Saves on change", "The effect shown beside the control"],
    url: "Nothing, usually: a preference is not a place.",
    routes: ["admin/settings", "admin/roles", "settings/preferences", "settings/security"],
  },
  {
    key: "record",
    name: "One subject, in tabs",
    shape:
      "An identity block that stays put, and tabs over the parts of one subject that are read separately.",
    when:
      "Everything on the page is about one thing, and the parts are read on different occasions rather than together.",
    unless:
      "The parts are read *at the same time* — then tabs hide half the answer, and a reader has to remember the other half while looking at this one.",
    wireframe: [
      [{ label: "Header · status · actions", span: 12 }],
      [
        { label: "The record", span: 8, primary: true },
        { label: "Related · activity", span: 4, rows: 2 },
      ],
      [{ label: "Tabs: comments, audit, files", span: 8 }],
    ],
    pieces: ["useRecordPage", "RecordContent", "AuditTimeline", "CommentThread"],
    url: "The record, and which tab — so a link opens on the thing being discussed.",
    routes: ["profile"],
  },
  {
    key: "console",
    name: "Operations console",
    shape:
      "Status at the top, a live list beneath it, and controls that name their refusals.",
    when: "Somebody is supervising something running and may need to intervene.",
    unless:
      "Nothing can be intervened in — a console with no verbs is a list, and calling it a console promises an action that is not there.",
    wireframe: [
      [{ label: "Header · the one number that matters", span: 12 }],
      [{ label: "What needs doing", span: 12, primary: true }],
      [{ label: "Detail", span: 6 }, { label: "Detail", span: 6 }],
    ],
    pieces: ["A headline metric strip", "The queue", "Drill-through on every count"],
    url: "The period and whatever narrows it.",
    routes: ["admin/health"],
  },
  {
    key: "findings",
    name: "Findings report",
    shape:
      "Totals at the top, then one card per thing that is wrong — what it is, why it matters, what to do, and a link to the rows.",
    when:
      "The page's subject is a set of *problems*, each needing a sentence of explanation and a different remedy.",
    unless:
      "The items are homogeneous — then they are rows, and a table of two hundred is readable where two hundred cards are not.",
    wireframe: [
      [{ label: "Header · how bad, overall", span: 12 }],
      [{ label: "Finding", span: 12, primary: true }],
      [{ label: "Finding", span: 12 }],
      [{ label: "Finding", span: 12 }],
    ],
    pieces: ["One row per finding", "Severity as more than colour", "A link to the rows behind it"],
    url: "Which dataset, and which finding is expanded.",
    // The passing checks are drawn too, which is what separates this shape
    // from a list of problems: a page showing only failures cannot be told
    // apart from a page whose checks are broken.
    routes: ["admin/quality"],
  },
  {
    key: "index",
    name: "Section index",
    shape: "Cards leading into a section, each saying what is behind it.",
    when:
      "A section has many pages and a reader arriving at it does not know which they want.",
    unless:
      "There are three pages — the navigation already lists them, and an index of three is a click nobody needed.",
    wireframe: [
      [{ label: "Header", span: 12 }],
      [{ label: "Section", span: 6 }, { label: "Section", span: 6 }],
    ],
    pieces: ["A card per destination", "Permission-aware links"],
    url: "Nothing: an index is the start of a journey rather than a place in one.",
    routes: ["admin", "showcase/components", "showcase/templates"],
  },
  {
    key: "problem",
    name: "Problem page",
    shape:
      "One centred explanation: what happened, what to do about it, and the reference that makes it findable.",
    when:
      "The page cannot be shown at all — a wrong address, a missing permission, a fault, an API that is not answering.",
    unless:
      "The *data* is missing rather than the page — an empty list is a normal answer to a reasonable question, and dressing it as a failure teaches a reader to ignore both.",
    wireframe: [
      [{ label: "What happened", span: 12, primary: true }],
      [{ label: "What to do next", span: 12 }],
      [{ label: "The reference to quote", span: 12 }],
    ],
    pieces: ["ProblemPage", "The correlation id", "A retry, where retrying can work"],
    url: "The status, so the page is addressable and can be looked at before it is needed.",
    // Addressable on purpose: two of the six cannot be reached by asking, so
    // without a route they would be screens nobody could look at until the day
    // they mattered (§34).
    routes: [
      "errors/401",
      "errors/403",
      "errors/404",
      "errors/500",
      "errors/maintenance",
      "errors/session-expired",
      // A feature switched off, which is not a permission refusal: the shell
      // shows it in place, and it is addressable so it can be looked at (§27).
      "errors/switched-off",
    ],
  },
  {
    key: "redirect",
    name: "Not a layout",
    shape: "A route that resolves to another one.",
    when:
      "An address has to keep working — a bookmark, an old link, a shortcut somebody typed.",
    unless: "Never: these exist so links do not rot, and they carry what they were given.",
    wireframe: [[{ label: "→ somewhere else", span: 12 }]],
    pieces: ["Navigate, replace"],
    url: "The address that used to work, kept working.",
    routes: ["system"],
  },
];

/** Every route the gallery accounts for, flattened. */
export function classified(): string[] {
  return LAYOUTS.flatMap((layout) => layout.routes).sort();
}

/** Which layout a route is built as, or `undefined` when unclassified. */
export function layoutOf(route: string): PageLayout | undefined {
  return LAYOUTS.find((layout) => layout.routes.includes(route));
}

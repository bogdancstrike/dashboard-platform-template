import type { PageLayout } from "./types";

/** Wizards, builders, canvases, search, settings, records, consoles, findings and indexes: pages that do one thing. */
export const WORK_LAYOUTS: readonly PageLayout[] = [
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
    routes: ["reports/builder", "charts/builder", "workflows", "reports", "ai/insights"],
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
    routes: ["maps", "calendar", "find/relationships", "analytics", "timeline"],
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
    routes: ["admin", "showcase/components", "showcase/templates", "onboarding"],
  },
];

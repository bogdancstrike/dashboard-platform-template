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

/** One layout the template offers, with what it is for and what it costs. */
export interface PageLayout {
  key: string;
  name: string;
  /** What shape the reader sees. One sentence. */
  shape: string;
  /** The question this layout is the right answer to. */
  when: string;
  /** When it is the wrong answer — the half a gallery usually omits. */
  unless: string;
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
    // `/tickets` is the split one of the entity pages, deliberately: working a
    // support queue means the next ticket matters as much as the current one
    // (§62, §63), which is not true of a customer directory.
    routes: ["mail", "explore", "tickets"],
  },
  {
    key: "board",
    name: "Board",
    shape: "Columns of cards, dragged between them, with a limit per column.",
    when: "The *state* is the thing being managed and the counts per state are the point.",
    unless:
      "There are more than a few hundred cards, or the states are not a workflow — a board of nine columns is a table with extra steps.",
    routes: ["kanban"],
  },
  {
    key: "grid",
    name: "Dashboard grid",
    shape: "Resizable widgets on a saved grid, arranged by whoever owns the dashboard.",
    when: "The reader is watching numbers rather than looking for a record.",
    unless:
      "Everybody needs the same three numbers — then a header of stat cards is less to build and less to get wrong.",
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
    routes: ["maps", "calendar", "find/relationships", "analytics"],
  },
  {
    key: "search",
    name: "Search results",
    shape: "One box, results grouped by what they are, and the keyboard doing the walking.",
    when: "The reader knows a word and not where it lives.",
    unless:
      "They know the dataset — then a filtered list gets them there in one step instead of two.",
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
    routes: ["admin/settings", "admin/roles", "settings/preferences", "settings/security"],
  },
  {
    key: "console",
    name: "Operations console",
    shape:
      "Status at the top, a live list beneath it, and controls that name their refusals.",
    when: "Somebody is supervising something running and may need to intervene.",
    unless:
      "Nothing can be intervened in — a console with no verbs is a list, and calling it a console promises an action that is not there.",
    routes: ["admin/health"],
  },
  {
    key: "index",
    name: "Section index",
    shape: "Cards leading into a section, each saying what is behind it.",
    when:
      "A section has many pages and a reader arriving at it does not know which they want.",
    unless:
      "There are three pages — the navigation already lists them, and an index of three is a click nobody needed.",
    routes: ["admin", "showcase/components", "showcase/templates"],
  },
  {
    key: "redirect",
    name: "Not a layout",
    shape: "A route that resolves to another one.",
    when:
      "An address has to keep working — a bookmark, an old link, a shortcut somebody typed.",
    unless: "Never: these exist so links do not rot, and they carry what they were given.",
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

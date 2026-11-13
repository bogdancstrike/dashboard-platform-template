/**
 * How a "create" opens, and why that shape (§10, §33).
 *
 * A platform that opens every create the same way is telling the reader that
 * every decision is the same size, and they are not: naming a folder is one
 * word, writing an announcement is a form, and composing a dashboard is a
 * sequence of choices where each one narrows the next. A drawer sliding in to
 * collect eight characters is theatre; a modal holding fourteen fields is a
 * form in a box too small for it; and a wizard for one field is four clicks
 * where one would do.
 *
 * So there are five shapes, and this is the declaration of which create uses
 * which. `creates.test.ts` asserts it against the code: every shape is
 * actually used, every entry's implementation contains the component its shape
 * implies, and — the assertion that keeps this true — every "new something"
 * control in the shipped sources is classified here. A create added without a
 * decision about its shape fails a test.
 *
 * Rendered on `/showcase/templates` for the same reason the layouts are: the
 * question "what shapes does this template give me, and when do I reach for
 * each" deserves an answer inside the product rather than in a wiki nobody
 * updates.
 */

/** The five ways a create opens. */
export type CreateShape = "in place" | "modal" | "drawer" | "wizard" | "page";

export interface CreateShapeSpec {
  key: CreateShape;
  name: string;
  /** The size of decision it fits. */
  when: string;
  /** When it is the wrong answer — the half that stops it being a default. */
  unless: string;
  /** What a reader will find in the code: the AntD component it is built on. */
  built: string;
}

export const CREATE_SHAPES: readonly CreateShapeSpec[] = [
  {
    key: "in place",
    name: "In place",
    when: "The new thing belongs in a list the reader is already looking at, and its whole content is a line of text.",
    unless: "Anything else has to be decided at the same time — an owner, a date — because then the row is a form pretending not to be one.",
    built: "An input where the row will be",
  },
  {
    key: "modal",
    name: "Plain modal",
    when: "One question, occasionally two. A name; a name and where it goes.",
    unless: "The answer needs the page behind it — a filter to read, a table to compare against — because a modal covers exactly that.",
    built: "Modal",
  },
  {
    key: "drawer",
    name: "Drawer",
    when: "One object's fields: enough to need a form, not enough to need steps. The page stays visible beside it.",
    unless: "The fields depend on each other in a way that makes half of them meaningless until an earlier one is answered — that is a wizard.",
    built: "Drawer",
  },
  {
    key: "wizard",
    name: "Wizard",
    when: "The decision has parts, and each part narrows the next. Nothing is written until the last step, and the review step is the point.",
    unless: "The parts are independent — then the reader is being made to click Next four times for no reason.",
    built: "Steps",
  },
  {
    key: "page",
    name: "Its own page",
    when: "Composing the thing *is* the work: a report, a chart. It wants the whole window, a live preview, and its own address so a half-built draft can be shared.",
    unless: "The reader was in the middle of something else — a create that navigates away loses their place.",
    built: "A route in App.tsx",
  },
];

export interface CreateFlow {
  /** What gets created, in the reader's words. */
  what: string;
  shape: CreateShape;
  /** Where the control is. A route, without the leading slash. */
  where: string;
  /** The `data-testid` of the control that opens it, where it has one. */
  testId?: string;
  /** The module that opens it, relative to `frontend/src`. */
  opens: string;
  /** Why this shape and not the next one up. */
  because: string;
}

/**
 * Every create in the platform, classified.
 *
 * Ordered by shape, smallest decision first, because that is the order
 * somebody choosing a shape for a *new* create wants to read them in: start at
 * the top and stop at the first one that fits.
 */
export const CREATE_FLOWS: readonly CreateFlow[] = [
  {
    what: "A card on a board",
    shape: "in place",
    where: "kanban",
    opens: "components/kanban/LaneColumn.tsx",
    because:
      "A card is a title in a lane. Everything else about it — assignee, due date, checklist — is edited afterwards in the card's own drawer, and asking for it up front would make adding a card slower than the work it describes.",
  },
  {
    what: "A checklist step, and a comment",
    shape: "in place",
    where: "tasks",
    opens: "components/planning/TaskPlanning.tsx",
    because:
      "Both are a line of text in a list that is already on screen. A dialog for a to-do item is a dialog for something the reader will type six of.",
  },
  {
    what: "A folder",
    shape: "modal",
    where: "files",
    testId: "new-folder",
    opens: "components/NameModal.tsx",
    because: "One question: what is it called. It goes where the reader already is.",
  },
  {
    what: "A lane on a board",
    shape: "modal",
    where: "kanban",
    opens: "components/NameModal.tsx",
    because: "Also one question — and unlike a card, a lane is structure, so it is worth a moment's deliberation rather than a row that appears as you type.",
  },
  {
    what: "A board",
    shape: "modal",
    where: "kanban",
    testId: "new-board",
    opens: "components/kanban/NewBoardModal.tsx",
    because: "A name and who can see it. Two questions, and the second has three answers.",
  },
  {
    what: "A tag",
    shape: "modal",
    where: "admin/tags",
    testId: "tag-new",
    opens: "pages/admin/TagsPage/TagForm.tsx",
    because: "A word and a colour. The vocabulary behind it is the page the modal sits on, and covering it costs nothing.",
  },
  {
    what: "A department",
    shape: "modal",
    where: "admin/organizations",
    testId: "new-department",
    opens: "pages/admin/OrganizationsPage/NewDepartmentModal.tsx",
    because: "A name, a parent and a manager: three fields that fit, on a page whose tree is the context for choosing the parent.",
  },
  {
    what: "A role",
    shape: "modal",
    where: "admin/roles",
    testId: "new-role",
    opens: "components/roles/NewRoleModal/index.tsx",
    because: "The name and the code, which is derived from it. The permissions are chosen afterwards against the matrix, which is the page underneath.",
  },
  {
    what: "A feature flag",
    shape: "modal",
    where: "admin/flags",
    testId: "new-flag",
    opens: "pages/admin/FlagsPage/NewFlagModal.tsx",
    because: "A key, a description and whether it is on. Small, and read beside the flags that already exist.",
  },
  {
    what: "A saved view or saved search",
    shape: "modal",
    where: "explore",
    opens: "components/explorer/SavedSearchForm/index.tsx",
    because:
      "The question is already composed — it is the list behind the modal. All that is left is a name and who else sees it, and covering the list would hide the thing being named.",
  },
  {
    what: "A record — task, project, ticket, order, customer, device",
    shape: "modal",
    where: "tasks",
    testId: "record-create",
    opens: "components/records/RecordForm/index.tsx",
    because:
      "One object's fields, built from the server's own declaration of which are writable, in a centred two-column sheet: a record is a short form with one decision at the end, and the list it lands in is right behind it when the sheet closes.",
  },
  {
    what: "An announcement",
    shape: "modal",
    where: "announcements",
    testId: "new-announcement",
    opens: "components/announcements/AnnouncementEditor.tsx",
    because: "A form — audience, severity, body, whether it needs agreement, when it expires — in a centred sheet, as the canvas draws it: one decision, made and published.",
  },
  {
    what: "A calendar event",
    shape: "drawer",
    where: "calendar",
    testId: "new-event",
    opens: "components/calendar/EventDrawer.tsx",
    because: "A form, and the calendar behind it is the context for the times chosen.",
  },
  {
    what: "An export",
    shape: "drawer",
    where: "exports",
    testId: "new-export",
    opens: "pages/ExportsPage/NewExportDrawer.tsx",
    because: "Dataset, format, columns and the filters to apply — one object's fields, and the list of previous exports stays in view.",
  },
  {
    what: "An automation",
    shape: "drawer",
    where: "workflows",
    testId: "new-automation",
    opens: "components/automations/AutomationDrawer/index.tsx",
    because:
      "A condition tree and a list of actions. It is the largest thing this template puts in a drawer, and it stays one because the rule being written is *about* the list of rules behind it.",
  },
  {
    what: "An API client",
    shape: "modal",
    where: "admin/api-clients",
    testId: "new-client",
    opens: "pages/admin/ApiClientsPage/NewClientModal.tsx",
    because: "A name, scopes and two limits fit one dialog; the secret it produces is shown once, in a second modal that asks before it closes.",
  },
  {
    what: "A group",
    shape: "modal",
    where: "admin/groups",
    testId: "new-group",
    opens: "pages/admin/GroupsPage/NewGroupModal.tsx",
    because: "A name, a kind and a description; the people and the grants come after, in the drawer it opens into.",
  },
  {
    what: "A dashboard widget",
    shape: "modal",
    where: "dashboards",
    testId: "add-widget",
    opens: "components/dashboards/WidgetModal.tsx",
    because: "A kind and the question it asks. The grid it will land on stays visible, which is how the reader judges where it goes.",
  },
  {
    what: "A dashboard",
    shape: "wizard",
    where: "dashboards",
    testId: "new-dashboard",
    opens: "components/dashboards/CreateDashboardWizard.tsx",
    because:
      "Three parts that narrow each other: what it is called, which cards it holds, and a review. A dashboard cannot be finished empty, so the shapes are chosen before anything is written.",
  },
  {
    what: "A report document",
    shape: "page",
    where: "reports/builder",
    testId: "new-document",
    opens: "pages/ReportBuilderPage/index.tsx",
    because:
      "Nothing to ask up front: a document arrives holding a heading and a paragraph, and everything about it — its name, its paper, what it holds — is changed in the composer with the page visible. A dialog demanding a title before the first block would be a form standing between somebody and the thing they came to make.",
  },
  {
    what: "A channel, from the rail",
    shape: "modal",
    where: "chat",
    testId: "new-channel",
    opens: "components/collab/ChatDialogs.tsx",
    because:
      "A name, who may join and whether it is private: two questions at most, and the conversation it creates is the next thing on screen.",
  },
  {
    what: "A direct message, from the rail",
    shape: "modal",
    where: "chat",
    testId: "new-direct",
    opens: "components/collab/ChatDialogs.tsx",
    because:
      "One question, who to talk to. Picking a person is the whole form, and the thread opens behind the dialog the moment it closes.",
  },
  {
    what: "A channel",
    shape: "modal",
    where: "chat",
    testId: "chat-new-channel",
    opens: "components/collab/ChatDialogs.tsx",
    because:
      "The same dialog as the rail button, offered in the empty state where a reader with no channels yet is looking.",
  },
  {
    what: "A direct message",
    shape: "modal",
    where: "chat",
    testId: "chat-new-direct",
    opens: "components/collab/ChatDialogs.tsx",
    because:
      "The same person picker as the rail button, offered in the empty state so the first conversation is one press away.",
  },
  {
    what: "An assistant conversation",
    shape: "in place",
    where: "assistant",
    testId: "assistant-new",
    opens: "components/assistant/AssistantChat.tsx",
    because:
      "A conversation is its first question. The button clears the thread and the question typed into the composer is what creates it, so there is nothing to ask up front.",
  },
  {
    what: "A documents question thread",
    shape: "in place",
    where: "ai/documents",
    testId: "ask-new",
    opens: "components/knowledge/AskPanel.tsx",
    because:
      "Like the assistant: a thread begins with the question typed where the answers will appear, and a dialog asking for a title first would be ceremony.",
  },
  {
    what: "A wiki page, from the page tree",
    shape: "modal",
    where: "docs",
    testId: "new-page-rail",
    opens: "components/docs/NewPageModal.tsx",
    because:
      "A title and where it sits in the tree. The page itself is written afterwards, in place, which is where a document belongs.",
  },
  {
    what: "A wiki page",
    shape: "modal",
    where: "docs",
    testId: "new-page",
    opens: "components/docs/NewPageModal.tsx",
    because:
      "The header twin of the tree button: the same title-and-parent dialog, because the same two answers are all a blank page needs.",
  },
  {
    what: "A wiki space",
    shape: "modal",
    where: "docs",
    testId: "new-space",
    opens: "pages/DocsPage.tsx",
    because:
      "A name, a key and who can see it. Short enough for a dialog, and the tree it adds to is the page the dialog closes onto.",
  },
  {
    what: "A document collection",
    shape: "modal",
    where: "ai/documents",
    testId: "collection-new",
    opens: "components/knowledge/CollectionModal.tsx",
    because:
      "A name, a colour and who may read it. The files go in afterwards by dropping them on the collection, which a dialog could not show.",
  },
  {
    what: "A metric watch",
    shape: "drawer",
    where: "alerts",
    testId: "watch-new",
    opens: "components/recordsAnalytics/WatchForm.tsx",
    because:
      "A metric, a threshold, a window and who to tell: enough fields to need a form, and the list of existing watches stays visible beside it to compare against.",
  },
  {
    what: "A contract",
    shape: "drawer",
    where: "contracts",
    testId: "contract-new",
    opens: "components/recordsAnalytics/ContractForm/index.tsx",
    because:
      "Customer, value, dates and renewal terms are one object's fields, and the pipeline behind the drawer is the context they are entered against.",
  },
  {
    what: "An intake form",
    shape: "page",
    where: "admin/forms/:id",
    testId: "forms-new",
    opens: "pages/decisions/FormDesignerPage.tsx",
    because:
      "Designing a form means arranging fields and previewing the result, and the designer has its own address so a half-designed form can be reopened.",
  },
  {
    what: "An SLA policy or business calendar",
    shape: "drawer",
    where: "admin/sla",
    testId: "sla-new",
    opens: "pages/decisions/SlaPoliciesPage/PolicyDrawer.tsx",
    because:
      "Targets per priority, business hours and escalation steps are a long form for one object; the policies table stays in view to copy from.",
  },
  {
    what: "A sprint",
    shape: "modal",
    where: "sprints",
    testId: "sprint-new",
    opens: "components/planning/SprintModals.tsx",
    because:
      "A name, a goal and two dates. The planning itself happens on the board afterwards, by dragging work into the sprint.",
  },
  {
    what: "An import",
    shape: "wizard",
    where: "import",
    opens: "pages/ImportPage/index.tsx",
    because:
      "Upload, map the columns, check the sample, run it. Every step depends on the one before — a mapping is meaningless before the file is read — and the check step is the point of the whole flow.",
  },
  {
    what: "A report",
    shape: "page",
    where: "reports/builder",
    testId: "new-report",
    opens: "pages/ReportBuilderPage/index.tsx",
    because:
      "Composing the question is the work, the answer is previewed live beside it, and the draft lives in the URL so a half-built report can be sent to somebody.",
  },
  {
    what: "A chart",
    shape: "page",
    where: "charts/builder",
    opens: "pages/ChartBuilderPage/index.tsx",
    because:
      "The same reason, picture first: fourteen live thumbnails of the reader's own numbers is a gallery, and a gallery does not fit in a drawer.",
  },
];

/** The flows that open one shape, in declaration order. */
export const flowsOf = (shape: CreateShape): CreateFlow[] =>
  CREATE_FLOWS.filter((flow) => flow.shape === shape);

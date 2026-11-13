/**
 * Which dialogs ask before discarding, and which deliberately do not (§74).
 *
 * An AntD drawer or modal closes on `Esc` and on a click outside it, and the
 * form inside holds its values in memory — so the gesture that dismisses a
 * dialog somebody has been typing into for two minutes is the same gesture
 * that dismisses one they opened by mistake. Nineteen such layers ship here,
 * and exactly one of them guarded before this file existed.
 *
 * The rule, and both halves matter:
 *
 * * **Guard when closing would lose something the reader typed or chose.** An
 *   email, an announcement, a rule tree, a widget's question, a role's name
 *   and code.
 * * **Do not guard otherwise, and say why.** A dialog whose state lives on the
 *   page behind it loses nothing — reopening shows the same choices — and a
 *   dialog holding one field that *is* the thing being named costs one gesture
 *   to retype. A confirmation there is the kind of guard that teaches people
 *   to click through confirmations, which is how the guards that matter stop
 *   working.
 *
 * `guards.test.ts` asserts this against the sources: every module that renders
 * a form inside a drawer or a modal is listed here, and a `guarded` one has to
 * use the hook. A dialog added without deciding fails the suite.
 */

/** One dialog that holds a form, and what was decided about closing it. */
export interface GuardedLayer {
  /** The module, relative to `frontend/src`. */
  module: string;
  /** What the reader is editing, in the sentence the guard uses. */
  what: string;
  /** Whether closing it asks first. */
  guarded: boolean;
  /** Why — required either way, because both answers are decisions. */
  because: string;
}

export const LAYERS: readonly GuardedLayer[] = [
  {
    module: "components/records/RecordForm.tsx",
    what: "record",
    guarded: true,
    because: "A record's writable fields, typed. This was the first guard in the platform and the reason the hook exists.",
  },
  {
    module: "components/mail/Composer.tsx",
    what: "message",
    guarded: true,
    because: "An email half-written is the clearest case there is: a click outside the dialog would throw away prose.",
  },
  {
    module: "components/announcements/AnnouncementEditor.tsx",
    what: "announcement",
    guarded: true,
    because: "Audience, severity, body, whether it needs agreement, when it expires — a form, with a paragraph in it.",
  },
  {
    module: "components/calendar/EventEditor.tsx",
    what: "event",
    guarded: true,
    because: "Times, participants, a recurrence rule and a reminder: several choices that are slow to make twice.",
  },
  {
    module: "components/automations/AutomationWizard.tsx",
    what: "automation",
    guarded: true,
    because: "A condition tree and a list of actions, built over several steps. Nothing is written until the last one.",
  },
  {
    module: "components/dashboards/CreateDashboardWizard.tsx",
    what: "dashboard",
    guarded: true,
    because: "Three steps that narrow each other, and choosing cards arms the guard as well as typing the name.",
  },
  {
    module: "components/explorer/SavedSearchForm.tsx",
    what: "saved search",
    guarded: true,
    because: "A name, a description, an audience and the people it is shared with — four answers, none of them retyped in a gesture.",
  },
  {
    module: "components/analysis/SaveAnalysisDialog.tsx",
    what: "analysis",
    guarded: true,
    because: "The same four answers, for a chart or a report. The question itself is in the URL, but the naming is not.",
  },
  {
    module: "components/roles/NewRoleModal.tsx",
    what: "role",
    guarded: true,
    because: "A name and the code derived from it, which the reader may have edited away from the derivation.",
  },
  {
    module: "components/kanban/NewBoardModal.tsx",
    what: "board",
    guarded: true,
    because: "A name, a description of how the board is run, and who can see it.",
  },
  {
    module: "pages/DashboardsPage.tsx",
    what: "dashboard",
    guarded: true,
    because: "The settings drawer holds the dashboard's own name, what it is for, its audience and whether it is home — six answers, and the drawer closes on a click outside it.",
  },
  {
    module: "pages/ReportBuilderPage.tsx",
    what: "document",
    guarded: false,
    because: "The composer's own dialog holds two fields — a name and a sentence about what the document is for — and the *document* is guarded by something better than a prompt: an explicit Save, an unsaved badge in the header, and a draft that is never silently discarded because closing the dialog does not close the document.",
  },
  {
    module: "components/profile/EditProfileDrawer.tsx",
    what: "profile",
    guarded: true,
    because: "Eight fields about a person — their name, how to reach them, what they do and what clock they keep — and the drawer closes on a click outside it, which is a whole form's worth of typing lost to a stray press.",
  },
  {
    module: "components/dashboards/WidgetModal.tsx",
    what: "widget",
    guarded: true,
    because: "A widget's question is a kind, a dataset, a grouping, a measure and a period, chosen against a live preview — and a modal closes on Esc and on a click outside it.",
  },
  {
    module: "pages/admin/GroupsPage/NewGroupModal.tsx",
    what: "group",
    guarded: true,
    because: "A name, a kind and a description. The detail drawer beside it is unguarded on purpose — see below.",
  },
  {
    module: "pages/admin/ApiClientsPage/NewClientModal.tsx",
    what: "client",
    guarded: true,
    because: "A name, the scopes it may use and a rate limit — and the scopes are chosen from a list the reader has to read.",
  },
  {
    module: "pages/admin/FlagsPage/NewFlagModal.tsx",
    what: "flag",
    guarded: true,
    because: "A key, a name and a description of what the flag turns on, which is prose somebody thought about.",
  },
  {
    module: "pages/admin/OrganizationsPage/NewDepartmentModal.tsx",
    what: "department",
    guarded: true,
    because: "A name, a code, a parent and a manager, chosen against a tree the reader had to navigate.",
  },
  {
    module: "pages/admin/TagsPage/TagForm.tsx",
    what: "tag",
    guarded: true,
    because: "A word, a category and a colour — small, but the colour is a choice made by looking at the others.",
  },
  {
    module: "components/NameModal.tsx",
    what: "name",
    guarded: false,
    because: "One field, and the field *is* the thing being named. A confirmation over eight characters is the guard that teaches people to dismiss guards.",
  },
  {
    module: "components/records/BulkDialog.tsx",
    what: "bulk change",
    guarded: false,
    because: "The selection — the expensive part — lives on the page behind it and survives the close. What the dialog holds is one field and one value, and it shows a preview before anything is applied (§75).",
  },
  {
    module: "pages/ExportsPage/NewExportDrawer.tsx",
    what: "export",
    guarded: false,
    because: "The dataset, format, columns and filters live on the page, so closing the drawer and reopening it shows exactly the same choices. There is nothing to lose, and asking would be theatre.",
  },
  {
    module: "components/recordsAnalytics/ContractForm/index.tsx",
    what: "contract",
    guarded: true,
    because: "Customer, value, term, billing, notice, renewal, stage and probability — fourteen answers in a drawer that closes on a click outside it.",
  },
  {
    module: "components/recordsAnalytics/WatchForm.tsx",
    what: "watch",
    guarded: true,
    because: "A metric, its filters, a detection method tuned against a live chart, and who to tell: slow to choose and slower to choose twice.",
  },
  {
    module: "components/recordsAnalytics/PublicLinksDrawer.tsx",
    what: "public link",
    guarded: false,
    because: "Each link is created or revoked by its own button the moment it is pressed; the small form only labels the next link, and nothing typed there is worth a question.",
  },
  {
    module: "components/collab/ChatDialogs.tsx",
    what: "channel",
    guarded: false,
    because: "A channel name, a person to message, a member to add: one answer per dialog, and the dialog is the step before a conversation rather than the work itself.",
  },
  {
    module: "components/decisions/EntryModal.tsx",
    what: "time entry",
    guarded: false,
    because: "A date, a duration and a line of notes. Logging time is quick by design and a confirmation on top of it would cost more than retyping the entry.",
  },
  {
    module: "components/docs/NewPageModal.tsx",
    what: "page",
    guarded: false,
    because: "A title and a parent. The page body is written afterwards in place and saved there, so this dialog never holds the prose that would be worth protecting.",
  },
  {
    module: "components/knowledge/CollectionModal.tsx",
    what: "collection",
    guarded: false,
    because: "A name, a colour and who may read it; the documents themselves are dropped on the collection afterwards, so there is nothing expensive held here.",
  },
  {
    module: "components/planning/SprintModals.tsx",
    what: "sprint",
    guarded: false,
    because: "A name, a goal and two dates, or the choice of where unfinished work goes. Short enough that asking before closing would be the bigger interruption.",
  },
  {
    module: "components/planning/TaskPlanning.tsx",
    what: "repeat rule",
    guarded: false,
    because: "The repeat dialog is one rule picked from presets with a preview of the next dates; the subtask and checklist inputs save on Enter, so nothing waits in memory.",
  },
  {
    module: "pages/DocsPage.tsx",
    what: "space",
    guarded: false,
    because: "A new space is a name, a key and who can see it — and the key is derived from the name, so closing loses at most one line of typing.",
  },
  {
    module: "pages/recordsAnalytics/CustomerHealthPage/ModelDrawer.tsx",
    what: "health model",
    guarded: false,
    because: "Weights are sliders with the current model as their starting point, and the drawer shows the stored model again when reopened; nothing typed is lost, only nudged.",
  },
  {
    module: "pages/decisions/ApprovalsPage/RuleModal.tsx",
    what: "approval rule",
    guarded: false,
    because: "A rule is a name, a dataset, a field and a condition, each picked from a list in seconds; a closed draft costs less to pick again than a confirmation costs every time.",
  },
  {
    module: "pages/decisions/SlaPoliciesPage/PolicyDrawer.tsx",
    what: "SLA policy",
    guarded: false,
    because: "The policy form opens fully filled with working defaults and the calendar modal with standard hours, so a closed draft returns to sensible values rather than to blank fields.",
  },
];

export const guardedLayers = (): GuardedLayer[] => LAYERS.filter((layer) => layer.guarded);
export const unguardedLayers = (): GuardedLayer[] => LAYERS.filter((layer) => !layer.guarded);

import type { GuardedLayer } from "./types";

/** Dialogs that close without asking, each with the reason nothing is lost. */
export const UNGUARDED_DIALOGS: readonly GuardedLayer[] = [
  {
    module: "pages/ReportBuilderPage/parts/SettingsDialog.tsx",
    what: "document",
    guarded: false,
    because: "The composer's own dialog holds two fields — a name and a sentence about what the document is for — and the *document* is guarded by something better than a prompt: an explicit Save, an unsaved badge in the header, and a draft that is never silently discarded because closing the dialog does not close the document.",
  },
  {
    module: "pages/ReportBuilderPage/parts/ComposeDialog.tsx",
    what: "composed draft",
    guarded: false,
    because: "Two choices — which dataset and over what period — asked before anything is written; reopening it costs two clicks, and what it composes is an ordinary document that is saved explicitly and guarded there.",
  },
  {
    module: "components/NameModal.tsx",
    what: "name",
    guarded: false,
    because: "One field, and the field *is* the thing being named. A confirmation over eight characters is the guard that teaches people to dismiss guards.",
  },
  {
    module: "components/records/BulkDialog/index.tsx",
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
    module: "components/recordsAnalytics/PublicLinksDrawer.tsx",
    what: "public link",
    guarded: false,
    because: "Each link is created or revoked by its own button the moment it is pressed; the small form only labels the next link, and nothing typed there is worth a question.",
  },
  {
    module: "components/collab/ChatDialogs/index.tsx",
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
    module: "components/planning/TaskPlanning/RecurrenceModal.tsx",
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

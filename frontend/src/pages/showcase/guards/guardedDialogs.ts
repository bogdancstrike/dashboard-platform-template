import type { GuardedLayer } from "./types";

/** Dialogs that ask before discarding: what they hold costs something to retype. */
export const GUARDED_DIALOGS: readonly GuardedLayer[] = [
  {
    module: "components/records/RecordForm/index.tsx",
    what: "record",
    guarded: true,
    because: "A record's writable fields, typed. This was the first guard in the platform and the reason the hook exists.",
  },
  {
    module: "components/mail/Composer/index.tsx",
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
    module: "components/calendar/EventEditor/index.tsx",
    what: "event",
    guarded: true,
    because: "Times, participants, a recurrence rule and a reminder: several choices that are slow to make twice.",
  },
  {
    module: "components/automations/AutomationWizard/index.tsx",
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
    module: "components/explorer/SavedSearchForm/index.tsx",
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
    module: "components/roles/NewRoleModal/index.tsx",
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
    module: "pages/DashboardsPage/parts/SettingsDrawer.tsx",
    what: "dashboard",
    guarded: true,
    because: "The settings drawer holds the dashboard's own name, what it is for, its audience and whether it is home — six answers, and the drawer closes on a click outside it.",
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
];

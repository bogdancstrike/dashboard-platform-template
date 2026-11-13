import type { CreateFlow } from "./types";

/** Creates in chat, the assistant, documents, docs, decisions and the builders. */
export const COLLABORATION_AND_BUILDER_FLOWS: readonly CreateFlow[] = [
  {
    what: "A channel, from the rail",
    shape: "modal",
    where: "chat",
    testId: "new-channel",
    opens: "components/collab/ChatDialogs/index.tsx",
    because:
      "A name, who may join and whether it is private: two questions at most, and the conversation it creates is the next thing on screen.",
  },
  {
    what: "A direct message, from the rail",
    shape: "modal",
    where: "chat",
    testId: "new-direct",
    opens: "components/collab/ChatDialogs/index.tsx",
    because:
      "One question, who to talk to. Picking a person is the whole form, and the thread opens behind the dialog the moment it closes.",
  },
  {
    what: "A channel",
    shape: "modal",
    where: "chat",
    testId: "chat-new-channel",
    opens: "components/collab/ChatDialogs/index.tsx",
    because:
      "The same dialog as the rail button, offered in the empty state where a reader with no channels yet is looking.",
  },
  {
    what: "A direct message",
    shape: "modal",
    where: "chat",
    testId: "chat-new-direct",
    opens: "components/collab/ChatDialogs/index.tsx",
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
    opens: "pages/DocsPage/NewSpaceModal.tsx",
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

/**
 * The guided tour of whichever page a reader is on (§77).
 *
 * The Help button in the header did nothing. Not "showed a link to
 * documentation" — nothing at all, which is worse than absent: a control that
 * answers no press teaches somebody that the chrome of this product is
 * decorative.
 *
 * What it does now is explain *this page*, in place, pointing at the real
 * controls. Four decisions.
 *
 * **A stop points at something on screen, by `data-testid`.** The same
 * attribute the tests address, deliberately: a tour whose targets were classes
 * or nth-children would break silently on a restyle, and one whose targets are
 * test ids breaks *a test* the moment somebody removes the control. The two
 * uses keep each other honest.
 *
 * **A stop whose target is not on the page is dropped, not centred.** Half of
 * these pages differ by role — a viewer has no "New dashboard" button — and a
 * tour that says "press the button in the corner" when there is no button in
 * the corner is worse than one that skips it (§76).
 *
 * **Every stop says *why*, not what.** "This is the filter bar" is visible
 * already. What is not visible is that the filters run in PostgreSQL rather
 * than in the browser, which is why the count is trustworthy and why it
 * survives paging — and that is the thing worth a tour.
 *
 * **The declaration lives here, not in the pages.** A page that carried its own
 * tour would be a page whose tour is only ever read by whoever edits that file;
 * one list is a list somebody can check, and `tours.test.ts` checks it against
 * the router.
 */

/** One stop: what to look at, and what is worth knowing about it. */
export interface TourStop {
  /**
   * The `data-testid` of the thing being pointed at.
   *
   * Absent means an untargeted stop, which is right exactly once per tour —
   * the opening one that describes the page as a whole.
   */
  target?: string;
  title: string;
  description: string;
}

/** Every page with something worth explaining, keyed by its route. */
export const TOURS: Record<string, TourStop[]> = {
  "/home": [
    {
      title: "What is waiting for you",
      description:
        "This page answers one question — what needs you today — and nothing else. The organisation's numbers are on the dashboard, one press away, because a landing page that opens on revenue is one people scroll past every morning.",
    },
    {
      target: "waiting",
      title: "Only what is actually waiting",
      description:
        "A count of nought is not drawn at all. A row of zeroes teaches you to stop looking at the strip, and then the one that is not zero is invisible too. Each tile opens exactly the rows it counted.",
    },
    {
      target: "home-shortcuts",
      title: "The doors",
      description:
        "Destinations, not create buttons — a tile reading “New email” that lands on an inbox is a lie you fall for once. Only the ones your role can open are here.",
    },
    {
      target: "home-recents",
      title: "Where you were",
      description:
        "Most mornings begin by reopening yesterday. The visit count is what separates a place you work from one you wandered into once.",
    },
  ],

  "/explore": [
    {
      title: "Ask the data anything",
      description:
        "Every dataset your role can read, queried through one endpoint. What you can filter, sort and group by comes from the server's own field catalogue — so this page can never offer a column the query would reject.",
    },
    {
      target: "view-mode",
      title: "Four ways to read one answer",
      description:
        "The same rows as a table, a list, cards or grouped. A table is for finding one record; the scanning modes are for reading down a set, and they load more rather than paging because a page boundary interrupts a read that had no reason to stop.",
    },
    {
      target: "explorer-settling",
      title: "It tells you when it is thinking",
      description:
        "The numbers on screen answer the last question that finished. While a new one is in flight the page says so, rather than showing a stale count as though it were the answer.",
    },
    {
      target: "bulk-bar",
      title: "Act on what you found",
      description:
        "Tick rows and the bar appears with the count on it. “Select everything matching” sends the *question*, not a list of ids — which is what lets it cover four hundred rows you have not scrolled to.",
    },
  ],

  "/dashboard": [
    {
      title: "The organisation's numbers, not yours",
      description:
        "Everything on this page is measured over a period and against the one before it of equal length, computed on the server. A dashboard that compared a full month with a part-month would be a page of arrows pointing the wrong way every first of the month.",
    },
    {
      target: "dashboard-alerts",
      title: "Only what is actually wrong",
      description:
        "The strip is absent when nothing needs attention — a permanent band reading “All good” is a band the eye stops seeing, and then the day it says something else it is invisible too. Each tag opens the rows behind it.",
    },
    {
      target: "dashboard-kpis",
      title: "A number nobody can act on is decoration",
      description:
        "Every tile carries its movement against the previous period and knows whether up is good: a rising backlog and rising revenue are not the same colour. Pressing one opens the records it counted, filtered to the same period.",
    },
    {
      target: "dashboard-charts",
      title: "Sized by what each one needs",
      description:
        "Not a uniform grid. A twenty-four-column heatmap in a third of the width is unreadable and a gauge in two thirds is mostly whitespace, so each shape declares its own span. Clicking a bar drills into the rows it stands for, carrying where you came from.",
    },
    {
      target: "dashboard-activity",
      title: "Who did what, while you were away",
      description:
        "The same feed as /activity, cut to this page's period. It is here because a number that moved and no record of anybody moving it is the start of a long afternoon.",
    },
  ],

  "/activity": [
    {
      title: "One thread through everything that happened",
      description:
        "Every write in the platform lands here — records, comments, files, shares — in one order, rather than each module keeping its own history that only its own page can read.",
    },
    {
      target: "activity-kinds",
      title: "Filter by what happened, not by where",
      description:
        "The kinds come from the server's own vocabulary, so this list cannot offer a kind the query would reject. Narrowing to “deleted” across every dataset is the question this page exists to answer.",
    },
    {
      target: "activity-actor",
      title: "A person, across modules",
      description:
        "Choosing somebody shows their whole day rather than their day in one dataset. That is the difference between an audit trail and a page of separate logs — and it is why the actor is a filter rather than a column you scan.",
    },
    {
      target: "activity-feed",
      title: "Each entry points at the record",
      description:
        "An entry you cannot open is a sentence about something you then have to go and find. Every row here carries the link, and the record it names is the one the entry was written about.",
    },
  ],

  "/notifications": [
    {
      title: "Everything that wanted your attention",
      description:
        "The centre of record for interruptions. A pop-up is a nudge that disappears; this is where the ones you missed are still waiting, which is why the two are separate settings in your preferences.",
    },
    {
      target: "unread-count",
      title: "Unread is a state, not a style",
      description:
        "The count is the server's, over everything rather than over the page you are looking at. Marking one read is applied at once and put back if the server refuses — so the number never disagrees with what you can see.",
    },
    {
      target: "live-status",
      title: "It says whether it is listening",
      description:
        "New notifications arrive over a live connection. When that connection drops the page says so and falls back to asking periodically, rather than going quiet and letting you believe nothing has happened.",
    },
    {
      target: "group-count",
      title: "Grouped by what caused them",
      description:
        "Twelve rows about one import is twelve interruptions about one event. They collapse into the thing that caused them, and the count is what tells you whether it is worth opening.",
    },
  ],

  "/announcements": [
    {
      title: "What the organisation is telling everybody",
      description:
        "Not notifications: a notification is addressed to you because of something you did, and an announcement is addressed to everybody because of something the organisation decided. The two have different lifetimes and different screens.",
    },
    {
      target: "announcement-board",
      title: "Published, and still inside its window",
      description:
        "An announcement carries a start and an end. One whose window has passed is not deleted — it is out of the board and still in the history, because “what were we told in March” is a real question.",
    },
    {
      target: "announcement-categories",
      title: "Category decides how loudly it lands",
      description:
        "A maintenance notice and a policy change are not the same interruption. The category drives the banner's weight and whether it can be dismissed, which is why it is chosen when the announcement is written rather than styled afterwards.",
    },
    {
      target: "announcement-history",
      title: "Including the ones nobody can see",
      description:
        "Drafts, scheduled ones and expired ones, for whoever may write them. A board that only showed what is live would give an author no way to check that tomorrow's notice exists and says the right thing.",
    },
  ],

  "/analytics": [
    {
      title: "One question, asked properly",
      description:
        "Group any dataset your role can read by any column it declares, and measure it however the catalogue allows. The same endpoint answers the chart builder, the report builder and the map — so the four screens cannot disagree about what a grouping means.",
    },
    {
      target: "analysis-scope",
      title: "The period is part of the question",
      description:
        "Named periods rather than two dates: “last 30 days” typed into two boxes on four screens is four slightly different answers by the end of the quarter. The server resolves the name, and every screen resolves it the same way.",
    },
    {
      target: "analysis-headline",
      title: "The answer, written as a sentence",
      description:
        "Built from the objects the SQL was built from, not from the controls you pressed — so it says what was actually asked. If the sentence surprises you, the query surprised you, and that is worth knowing before the number is quoted.",
    },
    {
      target: "analysis-matched",
      title: "What was matched, and what was drawn",
      description:
        "A chart of the top ten is not a chart of everything. The count says how many rows the question matched, and a collapsed tail is drawn as its own slice rather than dropped — a pie whose parts do not add to the total is a pie somebody reconciles twice.",
    },
  ],

  "/reports": [
    {
      title: "Questions somebody kept",
      description:
        "A report is a saved question, not a saved answer: opening one runs it again. That is why a report from March and the same report today are one definition over two months of data rather than two documents.",
    },
    {
      target: "reports",
      title: "Yours, and what has been shared with you",
      description:
        "Sharing a report shares the question. Every run still happens under the reader's own permissions, so a colleague who cannot read orders opens your orders report and is told so — rather than being handed rows they may not see.",
    },
    {
      target: "report-matched",
      title: "It says when it last ran, and how often",
      description:
        "A report nobody has run in a year is a definition nobody has checked against reality in a year. The run count is what separates the ones the team lives on from the ones somebody made once.",
    },
    {
      target: "run-report",
      title: "Run here, composed elsewhere",
      description:
        "This page answers; the chart builder composes the picture and the report builder puts several answers on a page with prose between them. Three screens because they are three jobs, and the question object is the same in all of them.",
    },
  ],

  "/charts/builder": [
    {
      title: "Picture-first, which is the half the report builder is not",
      description:
        "Here the question exists to make one picture as good as it can be. On /reports/builder a picture is one block on a page. Same compiler underneath, opposite centre of gravity.",
    },
    {
      target: "chart-question",
      title: "The question, in four parts",
      description:
        "Which rows, grouped how, measured how, over what period. Every option comes from the server's field catalogue, so this form cannot compose a question the query would reject.",
    },
    {
      target: "chart-preview",
      title: "Only the shapes the question can feed",
      description:
        "A line of categories implies an order the categories do not have, and a pie of months is a pie of months. Kinds that cannot read the current question are not offered — with the reason on hover — rather than offered and silently ignored.",
    },
    {
      target: "chart-themes",
      title: "Colour is not chosen here",
      description:
        "A palette per chart is how eighty screens end up with eighty greys. These are the platform's own scales, and the one thing that does carry meaning — status, severity, health — keeps its colour wherever it is drawn.",
    },
    {
      target: "open-save-chart",
      title: "Saving makes it available everywhere",
      description:
        "A saved chart is a report: it can go on a dashboard as a widget, into a document as a block, or be run on its own. That is why this screen has no export of its own — the answer belongs to the platform rather than to the page.",
    },
  ],

  "/maps": [
    {
      title: "The same analysis, on a ground",
      description:
        "Not a separate dataset. Anything with a place on it can be grouped and drawn here through the one analysis endpoint, which is why the totals here match the totals on a table of the same question.",
    },
    {
      target: "map-controls",
      title: "What is being measured, and where",
      description:
        "The dataset, the measure and the period are the question; the projection and the clustering are how it is drawn. Keeping them apart is what lets you change the picture without changing the answer.",
    },
    {
      target: "map-cities",
      title: "Clustered because a thousand pins is a blob",
      description:
        "Points that overlap at this zoom are drawn as one marker carrying its count. Zooming in splits them — the cluster is a rendering decision, not a filter, so nothing is hidden by it.",
    },
    {
      target: "map-coverage",
      title: "It says what it could not place",
      description:
        "Rows with no usable location are counted and named rather than quietly dropped. A map that showed nine hundred of a thousand records without saying so is a map somebody makes a decision from.",
    },
  ],

  "/compare": [
    {
      title: "Two records, side by side",
      description:
        "Reached from a list by ticking rows rather than from the menu, because comparing starts with having found something. One page for every dataset — six comparison routes would be six pages to keep in step.",
    },
    {
      target: "compare-show",
      title: "Differences first, or everything",
      description:
        "Forty identical fields between two records is forty rows of noise around the three that differ. Showing only what differs is the default; everything is one press away for when the absence of a difference is the finding.",
    },
    {
      target: "compare-table",
      title: "Fields from the declaration, not from the rows",
      description:
        "The columns are what the dataset says it has, so a field that is empty on both records still appears. A comparison built from the keys present in the data would silently omit exactly the field you were checking for.",
    },
    {
      target: "compare-identical",
      title: "“No differences” is an answer",
      description:
        "Said plainly rather than rendered as an empty table. An empty table reads as a page that failed to load, and the two need to be distinguishable at a glance.",
    },
  ],

  "/kanban": [
    {
      title: "Boards you keep, over the same tasks",
      description:
        "Not a second copy of the work. A board is a saved way of looking at tasks — which ones, in which lanes — and moving a card moves the task, so /tasks and a board can never disagree.",
    },
    {
      target: "board-picker",
      title: "One board per way of working",
      description:
        "A triage board and a sprint board are the same records under two arrangements. Keeping both means neither team has to bend their lanes to fit the other's.",
    },
    {
      target: "kanban-board",
      title: "A drop is a write, and it says so",
      description:
        "The card moves under your cursor, the lane accepts it, and the change is sent. If the server refuses — somebody else closed it, your role may not — the card goes back and you are told why, rather than a board that looks changed and is not.",
    },
    {
      target: "add-lane",
      title: "Lanes come from the status vocabulary",
      description:
        "A lane is a declared status, not a free-text column: a board with a lane called “nearly done” is a board whose cards are in a state no report can count. The vocabulary is the server's, so every board reads the same statuses.",
    },
  ],

  "/calendar": [
    {
      title: "The month, the week, the day, the list",
      description:
        "Four readings of the same events, chosen by what you are doing: a month for “when is it”, a week for “will it fit”, a day for “what is next”, an agenda for “what is coming at all”.",
    },
    {
      target: "calendar-view",
      title: "The view is in the address",
      description:
        "So is the date you are looking at. A calendar you cannot link somebody to is a calendar you describe over a call — this one you paste, and they land on the same week.",
    },
    {
      target: "cal-title",
      title: "Moving is keyboard-first",
      description:
        "The arrows step by whatever the current view is — a month in month, a week in week — and Today returns. A calendar that always stepped by a month would make the week view unusable with the keyboard.",
    },
    {
      target: "new-event",
      title: "Clashes are shown before you save",
      description:
        "An event overlapping something already in your day is pointed out while the form is open, not after. It is a warning rather than a refusal: double-booking on purpose is a real thing people do.",
    },
    {
      target: "calendar-pane",
      title: "An event opens beside the calendar",
      description:
        "Reading one should not cost your place in the month. The pane carries the attendees, the responses and the recurrence, and the calendar behind it stays where it was.",
    },
  ],

  "/files": [
    {
      title: "Folders, and what is actually in them",
      description:
        "Storage is object storage underneath, so a folder here is a prefix rather than a directory. That is why moving a large folder is instant and why a file can be linked to without being downloaded.",
    },
    {
      target: "folder-tree",
      title: "The tree is the permission boundary",
      description:
        "A folder you may not read is not in the tree at all — not greyed, not empty. Showing the name of a folder somebody cannot open tells them something about the organisation they were not meant to learn.",
    },
    {
      target: "dropzone",
      title: "Uploads are resumable and counted",
      description:
        "Each file goes straight to storage rather than through the application, so a large one does not hold a request open. The tray keeps its own state — closing this page does not cancel what is already in flight.",
    },
    {
      target: "file-list",
      title: "Previewed rather than downloaded",
      description:
        "Images, PDFs and text open in place. A file you must download to identify is a file you download three times, and every one of those copies then lives on somebody's laptop.",
    },
    {
      target: "file-total",
      title: "The size is the folder's, not the page's",
      description:
        "Counted on the server over everything beneath it, so it does not change as you scroll. A total that grew while you paged would be a total nobody could quote.",
    },
  ],

  "/workflows": [
    {
      title: "When this happens, do that",
      description:
        "Automations run on the server against the same vocabulary the rest of the platform uses, so a rule about “high severity” means what the ticket page means by it rather than matching a string.",
    },
    {
      target: "automation-list",
      title: "It says when each one last fired",
      description:
        "An automation that has never fired is either waiting for something rare or quietly broken, and the two look identical without a count. The run history is on the rule, beside the condition that was supposed to trigger it.",
    },
    {
      target: "new-automation",
      title: "Rehearsed before it is armed",
      description:
        "The wizard runs the condition against real records and shows what would have happened, without doing any of it. An automation whose first run is its first test is an automation that emails four hundred people.",
    },
  ],

  "/favorites": [
    {
      title: "Two lists, and only one of them is yours to keep",
      description:
        "Bookmarks are what you starred. Recents are where you have been, kept automatically. Mixing them would mean losing a deliberate mark under a week of wandering.",
    },
    {
      target: "bookmarks-table",
      title: "A star works on any record",
      description:
        "The same control on a list row, in a record drawer and on a detail page, against one store — so a thing you starred from the explorer is here, rather than in an explorer-shaped list of its own.",
    },
    {
      target: "recents-table",
      title: "Visits, not the last thing you clicked",
      description:
        "The count is what separates a place you work from one you wandered into once. It is why this list stays useful after a month rather than being a record of the last ten minutes.",
    },
    {
      target: "capacity",
      title: "It has a ceiling, and says so",
      description:
        "Recents are capped and the oldest fall off. Said plainly rather than silently, because a list that quietly forgets is one somebody relies on for exactly as long as it takes to matter.",
    },
  ],

  "/exports": [
    {
      title: "Taking rows out of the platform",
      description:
        "An export is a job, not a download: it is queued, it runs on the server, and the file waits for you. That is what makes a four-hundred-thousand-row export possible at all.",
    },
    {
      target: "new-export",
      title: "The estimate comes before the queue",
      description:
        "How many rows, how big, and how long — asked of the server before anything is started. An export whose size you only learn when it finishes is one somebody cancels and re-runs three times.",
    },
    {
      target: "exports-table",
      title: "Every export is somebody carrying data out",
      description:
        "Which is why each one is attributed, retained for a stated period and then removed. A file that lives forever on a shared link is the part of an export that outlasts the reason for it.",
    },
    {
      target: "limits",
      title: "The ceiling is the platform's, not the page's",
      description:
        "Row and size limits come from the server and are shown before you commit. A refusal after a five-minute wait is a refusal that cost five minutes.",
    },
  ],

  "/import": [
    {
      title: "A guided import, in four steps",
      description:
        "Choose a file, say what its columns mean, look at what will happen, then do it. Nothing is written until the last of those, which is what makes the third step worth reading.",
    },
    {
      target: "import-file",
      title: "The dialect is detected and shown",
      description:
        "Separator, quoting and encoding are guessed from the file and then stated, so you can correct the guess. A silent guess is how a semicolon-separated file becomes one column of nonsense.",
    },
    {
      target: "import-mapping",
      title: "Columns are mapped to declared fields",
      description:
        "The targets come from the dataset's own declaration, so an import cannot write to a field the platform does not have. Required fields left unmapped are named rather than discovered on the run.",
    },
    {
      target: "import-preview",
      title: "Rehearsed against the real validators",
      description:
        "The preview runs the same checks the write will, so a row that will be rejected is rejected here, with its reason and its line number. It is the difference between an import you can fix and one you have to undo.",
    },
    {
      target: "import-history",
      title: "Every run is kept, with its problems",
      description:
        "Including the rejected rows as a file you can download, correct and feed back in. An import that reports “412 failed” and cannot say which is an import somebody redoes from the top.",
    },
  ],

  "/find/global": [
    {
      title: "One box, every dataset",
      description:
        "Searched on the server across everything your role can read, rather than each module offering its own box over its own rows. What comes back is grouped by what it is, because “Vanguard” is a customer and a project and a ticket.",
    },
    {
      target: "global-total",
      title: "The count is over everything matched",
      description:
        "Not over what is drawn. A search that showed ten results and no total leaves you unable to tell a precise answer from the first page of a vague one.",
    },
    {
      target: "global-hit",
      title: "The match is shown in context",
      description:
        "With the matched words marked in the line they were found in, so you can see *why* a row came back. A list of names with no context is a list you open one by one.",
    },
  ],

  "/find/catalog": [
    {
      title: "What this platform knows about, declared",
      description:
        "Every dataset, its fields, their types and what may be filtered, sorted or grouped by. This is the same declaration the explorer, the analysis endpoint and the report builder read — so it is documentation that cannot go stale.",
    },
    {
      target: "catalog",
      title: "Read it before composing a question",
      description:
        "A field that is not marked filterable is one no screen will offer you, and knowing that here saves composing a query that cannot be asked. Each entry links to the dataset in the explorer.",
    },
  ],

  "/find/relationships": [
    {
      title: "How the records connect",
      description:
        "The same graph the platform's own foreign keys describe, drawn rather than described. A schema diagram in a document is out of date the first time somebody adds a column.",
    },
    {
      target: "relationship-view",
      title: "Force-directed, so shape means something",
      description:
        "Records that reference each other pull together, so a cluster is a genuine neighbourhood rather than an arrangement somebody chose. Dragging a node pins it, which is how you read one thread out of a knot.",
    },
    {
      target: "analysis-view",
      title: "The numbers behind the picture",
      description:
        "Communities, how strongly they hold together, and which records bridge between them. A graph is persuasive and hard to quote; these are the figures you can put in a sentence.",
    },
  ],

  "/projects": [
    {
      title: "Delivery, schedule and budget on one row",
      description:
        "Three numbers that only mean something together: a project at ninety per cent delivered, eighty per cent through its schedule and a hundred and ten per cent through its budget is a sentence, and three separate columns are not.",
    },
    {
      target: "project-table",
      title: "The gap is named, not left to be computed",
      description:
        "The page says which projects are behind and by how much, rather than presenting the inputs and trusting everybody to do the subtraction the same way.",
    },
    {
      target: "entity-metrics",
      title: "Measured over what you filtered to",
      description:
        "Every dataset declares its own headline figures, and they are computed on the server over the whole filtered set — not over the rows on this page. Filtering to one department gives that department's numbers.",
    },
  ],

  "/tickets": [
    {
      title: "A queue read against its clock",
      description:
        "A ticket has four timestamps and one thing that matters: whether it is going to breach. The standing is computed from the clock rather than left as four columns to compare in your head.",
    },
    {
      target: "sla-filter",
      title: "SLA gets a control of its own",
      description:
        "Because it is why the page is open. Breached, at risk, and comfortable are the three answers anybody triaging actually wants, and burying them in a general filter makes the common case the slow one.",
    },
    {
      target: "ticket-queue",
      title: "Severity is colour; everything else is not",
      description:
        "A row is not tinted because tinting looks busy. Colour here carries one meaning, which is what keeps it readable when half the queue is urgent.",
    },
  ],

  "/customers": [
    {
      title: "An account, not seven columns",
      description:
        "Customers are read as cards because that is how people hold them in mind — a name, a size, a state and a recent history — rather than as a row you decode left to right.",
    },
    {
      target: "customer-grid",
      title: "Each card is a starting point",
      description:
        "The orders, the tickets and the projects belonging to an account are one press from its card. That link is the reason this page exists rather than a filter on every other page.",
    },
  ],

  "/orders": [
    {
      title: "Paid and fulfilled are two questions",
      description:
        "An order can be one and not the other, and a single “status” column that had to choose between them would be a column that lies about half the ledger. They are separate here, and filterable separately.",
    },
    {
      target: "order-ledger",
      title: "The total is the server's",
      description:
        "Summed over everything the filters matched rather than over the rows drawn, so it does not change as you page. A total that only covered the visible page is a number somebody quotes by accident.",
    },
    {
      target: "entity-total",
      title: "Peek without leaving the ledger",
      description:
        "Opening a row shows it beside the list and puts it in the address, so you can send somebody the row you are looking at. Reading twenty orders should not cost twenty navigations.",
    },
  ],

  "/devices": [
    {
      title: "A fleet, by what it is doing",
      description:
        "Devices are grouped by state rather than listed alphabetically, because the question is almost never “where is this one” and almost always “what is not reporting”.",
    },
    {
      target: "device-fleet",
      title: "Last seen is the column that matters",
      description:
        "A device that has not checked in is the finding; its model and its location are context for that finding. The page is ordered to put the first thing first.",
    },
  ],

  "/settings/security": [
    {
      title: "Where you are signed in, and what happened",
      description:
        "Sessions and sign-ins are yours, not an administrator's report about you. Somebody has to be able to see their own account's history without asking, or nobody checks it at all.",
    },
    {
      target: "sessions-table",
      title: "Your current session is marked",
      description:
        "So that ending the others is a safe press. A list of six identical sessions with no way to tell which one you are using is a list nobody acts on.",
    },
    {
      target: "revoke-others",
      title: "Ending a session is immediate",
      description:
        "Not at the next token refresh. A revocation that takes fifteen minutes to apply is not a revocation you can use when you think somebody else is signed in.",
    },
    {
      target: "sign-ins-table",
      title: "Failures are here too",
      description:
        "A successful sign-in from somewhere unexpected and a run of failures from somewhere unexpected mean different things, and you need both to tell which one you are looking at.",
    },
  ],

  "/showcase/components": [
    {
      title: "The parts, with their rules attached",
      description:
        "A gallery of components without the rules is one somebody reads, picks whatever looks right from, and the product gains a fifth kind of grey. Each shelf here says what the part is for and when not to use it.",
    },
    {
      target: "feature-shelf",
      title: "Every capability, with a working example",
      description:
        "Not screenshots. These are live components against the same API the pages use, so a part that has stopped working stops working here — which is the point of keeping it.",
    },
    {
      target: "open-palette",
      title: "The button vocabulary, shown as four roles",
      description:
        "Primary, secondary, quiet and destructive. Described in a document, four roles become five; shown side by side, the missing one is visible. A test asserts no page uses a type outside these.",
    },
    {
      target: "missing-table",
      title: "It admits what is not here",
      description:
        "A gallery claiming complete coverage and quietly omitting three components is worse than one that lists the gaps. The list is generated from the declaration rather than maintained by hand.",
    },
  ],

  "/admin": [
    {
      title: "Everything that governs the platform",
      description:
        "Grouped by what it protects rather than alphabetically: who people are, what they may do, what the platform is doing, and what has been done. Nothing here is gated by a feature flag — an administrator could otherwise switch off their own way back.",
    },
    {
      target: "admin-map",
      title: "Only what your role can open",
      description:
        "A tile you cannot use is not shown greyed. Administration is exactly where a list of doors somebody cannot open teaches them the shape of a permission system they are not part of.",
    },
  ],

  "/admin/users": [
    {
      title: "People, and what they may do",
      description:
        "Identity comes from Keycloak; this is the platform's side of it — membership, role and standing. Editing somebody's role here changes what they may do at the next request rather than at their next sign-in.",
    },
    {
      target: "user-filters",
      title: "Filtered on the server",
      description:
        "Role and status are the two questions asked of this page — “who are the administrators” and “who is still active” — so they are controls rather than columns to sort by, and the count below reflects them.",
    },
    {
      target: "user-table",
      title: "A person is a record, not a row of switches",
      description:
        "Opening one shows their role, their groups, their sessions and their recent activity together, because deciding whether an account should still be active is a question you cannot answer from a status column.",
    },
  ],

  "/admin/roles": [
    {
      title: "What a role may do, as one page",
      description:
        "Permissions are the platform's own catalogue, so this screen cannot grant something nothing checks. Every page, every endpoint and every button reads the same list.",
    },
    {
      target: "custom-roles",
      title: "Built-in roles are shown, not edited",
      description:
        "Administrator, manager, member and viewer are what the seed, the tests and the documentation mean. A platform where the meaning of “viewer” is editable is a platform where no statement about viewers is true for long.",
    },
    {
      target: "new-role",
      title: "A role is copied, then narrowed",
      description:
        "Starting from an empty set of permissions produces a role somebody grants far too much to, because granting is what makes it work. Starting from the nearest existing role makes taking away the natural move.",
    },
  ],

  "/admin/groups": [
    {
      title: "Membership, separated from permission",
      description:
        "A group says who works together; a role says what they may do. Joining a team should not silently change what somebody may delete, which is what happens when the two are one concept.",
    },
    {
      target: "groups-table",
      title: "Groups are how sharing scales",
      description:
        "A dashboard shared with eleven people is eleven shares to revoke when somebody leaves. Shared with a group, it is one membership.",
    },
    {
      target: "group-grants",
      title: "Grants are additive, and shown as such",
      description:
        "A group can only ever add to what its members may do. A group that took permissions away would mean somebody's access depending on the order their groups were evaluated in.",
    },
  ],

  "/admin/organizations": [
    {
      title: "The shape of the organisation",
      description:
        "Departments, their people and who reports to whom. It is here rather than under users because the structure outlives any individual in it.",
    },
    {
      target: "org-tree",
      title: "Headcount is counted, not typed",
      description:
        "Each department's number is derived from the people actually in it. A typed headcount is a number that is wrong the first week and stays wrong.",
    },
    {
      target: "unplaced",
      title: "People with no department are named",
      description:
        "Rather than quietly excluded from every total. A tree whose numbers do not add up to the staff list is a tree somebody stops trusting.",
    },
  ],

  "/admin/tags": [
    {
      title: "The vocabulary people label records with",
      description:
        "Tags applied on records across every dataset are managed here as one list. Free-text labels produce four spellings of “urgent” within a month, and then nothing can be counted.",
    },
    {
      target: "tags-table",
      title: "Usage is on the tag",
      description:
        "How many records carry it, so an unused tag can be retired and a heavily used one is obviously not safe to rename casually.",
    },
    {
      target: "tags-categories",
      title: "Categories group the vocabulary",
      description:
        "A category is what makes a list of eighty tags navigable and what lets a record picker offer the right dozen first. It is also what gives a tag its colour, so colour stays meaningful.",
    },
  ],

  "/admin/settings": [
    {
      title: "The platform's own configuration",
      description:
        "Each setting carries its type, its allowed values and its default, so this screen renders a real control rather than a text box for everything. The declaration is the server's; this page only edits values.",
    },
    {
      target: "settings-categories",
      title: "Grouped by what they affect",
      description:
        "A flat list of sixty settings is one nobody finds anything in. The categories come from the declaration, which is also what keeps them in step as settings are added.",
    },
    {
      target: "settings-groups",
      title: "A changed value can be put back",
      description:
        "Every setting shows its default and offers a reset, so experimenting is reversible. A configuration screen with no way home is one people stop touching.",
    },
  ],

  "/admin/jobs": [
    {
      title: "What the platform is doing in the background",
      description:
        "Exports, imports, scheduled reports and maintenance all run as jobs on the same queue, so there is one place to answer “is it stuck” rather than one per feature.",
    },
    {
      target: "job-statuses",
      title: "Every status is reachable",
      description:
        "Queued, running, succeeded, failed and cancelled. A filter offering a state the system never produces is a filter that teaches somebody the system has states it does not.",
    },
    {
      target: "jobs-table",
      title: "A failure carries its reason",
      description:
        "The payload it ran with and the error it raised, together. A job list that says “failed” and nothing else is a list somebody has to read the server logs alongside.",
    },
  ],

  "/admin/logs": [
    {
      title: "The application's own log, readable",
      description:
        "Structured rather than a wall of text, so a line can be filtered by level, followed by its trace id, and opened next to the lines around it.",
    },
    {
      target: "log-levels",
      title: "Level is a filter, not a colour",
      description:
        "Warnings and errors are what this page is opened for. Being able to ask for them rather than scan for them is the difference between a log viewer and a text file.",
    },
    {
      target: "toggle-live",
      title: "Live, when you are watching something",
      description:
        "Off by default: a list that scrolls while you are reading it is one you cannot read. Turning it on says so plainly, and turning it off leaves you where you were.",
    },
    {
      target: "line-trace",
      title: "One request, end to end",
      description:
        "Every line carries the correlation id of the request that produced it, so a failure and the twelve lines that led to it can be pulled out of a busy log as one thread.",
    },
  ],

  "/admin/audit": [
    {
      title: "Who did what, kept separately",
      description:
        "Not the activity feed and not the log. An audit entry records a decision somebody made and cannot be edited or removed from this screen — a trail that can be tidied is not a trail.",
    },
    {
      target: "audit-total",
      title: "The count is over what you asked for",
      description:
        "Computed on the server over the whole filtered set, because “how many times did this happen” is the question audits are opened with.",
    },
    {
      target: "impersonated",
      title: "Acting as somebody else is marked",
      description:
        "An action taken while impersonating records both people. Recording only the impersonated account would make support indistinguishable from the user, which is the one thing an audit trail must never allow.",
    },
  ],

  "/admin/api": [
    {
      title: "Machines that talk to this platform",
      description:
        "A client is an identity with scopes, not a shared password. That is what makes it possible to say what a given integration did and to stop it without changing anything a person uses.",
    },
    {
      target: "clients-table",
      title: "Traffic is on the client",
      description:
        "Requests and errors, so a client that stopped working and a client nobody uses are distinguishable. Without it, retiring one is a guess.",
    },
    {
      target: "client-scopes",
      title: "Scopes are the platform's permissions",
      description:
        "The same catalogue roles are built from, so a client can never be granted something nothing checks — and reading what an integration may do needs no second vocabulary.",
    },
    {
      target: "client-keys",
      title: "A secret is shown once",
      description:
        "Stored hashed, so it cannot be shown again. Rotating adds a second live key before the first is removed, which is what lets a running integration be re-keyed without an outage.",
    },
  ],

  "/admin/integrations": [
    {
      title: "The outside services this depends on",
      description:
        "Each one says what it is for, whether it is reachable, and what stops working without it. A dependency whose absence is a mystery is a dependency nobody can plan around.",
    },
    {
      target: "integrations-table",
      title: "Checked, not assumed",
      description:
        "The state comes from an actual call rather than from whether configuration exists. Configured and working are different things, and the gap between them is where an outage lives.",
    },
    {
      target: "int-settings",
      title: "Credentials are write-only here",
      description:
        "Shown redacted and never returned by the API. A settings screen that renders a secret back into a text box is a secret in everybody's browser history.",
    },
  ],

  "/admin/quality": [
    {
      title: "Whether the data means what it claims",
      description:
        "Rules run against each dataset — required fields, references that resolve, values inside their declared vocabulary — so a broken assumption is found here rather than in a report six weeks later.",
    },
    {
      target: "quality-datasets",
      title: "Per dataset, because the answer is",
      description:
        "One overall percentage hides the dataset that is entirely broken behind five that are fine. Each is scored on its own and the worst is not averaged away.",
    },
    {
      target: "quality-findings",
      title: "A finding names its records",
      description:
        "With a link to exactly those rows in the explorer. A quality report that says “forty-one problems” and cannot show you the forty-one is a report nobody can act on.",
    },
  ],

  "/dashboards": [
    {
      title: "Layouts you compose",
      description:
        "Not the fixed dashboard — this is one you build for the job you actually do, and share the way you share a saved search.",
    },
    {
      target: "toggle-edit",
      title: "Editing is a mode, not a page",
      description:
        "A builder on its own screen is a builder whose result you cannot see. Turn this on and the same page gains handles: drag a card by its heading, drag a corner to resize, or use the arrow keys.",
    },
    {
      target: "add-widget",
      title: "The widget is drawn beside the choice",
      description:
        "Adding one opens the real card next to the form, filled with live data — so what you preview is what lands on the grid.",
    },
    {
      target: "auto-arrange",
      title: "Two arrangers, two questions",
      description:
        "“Tidy up” closes the gaps and leaves everything where it is. “Auto-arrange” also packs the rows and gives the leftover width back, so the result reads as full rather than ragged.",
    },
    {
      target: "board-share",
      title: "Sharing is not sharing data",
      description:
        "Somebody you share with sees your layout, and every widget still answers under *their* permissions. A colleague who cannot read orders sees the card say so.",
    },
  ],

  "/tasks": [
    {
      title: "Where the work is piled up",
      description:
        "Each lane is its own query, counted by the server — so “12 blocked” is the whole dataset and not the twelve rows that happen to be loaded.",
    },
    {
      target: "task-board",
      title: "Dragging says what it will do",
      description:
        "Pick a card up: the target lane is named, a slot opens where the card will land, and the lane it came from says “back where it was”. The move is applied straight away and taken back if the server refuses it.",
    },
  ],

  "/mail": [
    {
      title: "Three panes, and the page never scrolls",
      description:
        "Folders, conversations, and the one being read — each scrolls inside itself. Where the reading pane sits is yours to choose, under Preferences.",
    },
    {
      target: "mail-list",
      title: "A row is a conversation",
      description:
        "Not a message: a five-message thread would otherwise look like five problems. Unread is weight and a rule on the edge, never colour alone.",
    },
    {
      target: "mail-rail",
      title: "Every count is the server's",
      description:
        "The unread numbers are recomputed from rows whenever anything changes. A badge this page decremented itself would drift, and a wrong unread count is the most irritating bug a mailbox can have.",
    },
  ],

  "/reports/builder": [
    {
      title: "A document, not a chart",
      description:
        "The chart builder composes a *question*. This composes a *page*: a cover, headings, your own words, and the answers to several questions between them — exported as a real PDF or Word file.",
    },
    {
      target: "add-block",
      title: "Blocks",
      description:
        "A heading, a paragraph, a saved report's chart, rows from a dataset, a dataset's headline numbers. A block *names* a question rather than copying one, so the same document exported in June is June's data.",
    },
    {
      target: "document-paper",
      title: "The paper is the preview",
      description:
        "What you see is the document — same components, same endpoints the server resolves each block through when it writes the file.",
    },
    {
      target: "export-pdf",
      title: "The charts come from here",
      description:
        "There is no chart engine on the server. Your browser hands over the picture it has already drawn, so the file carries exactly what was on screen.",
    },
  ],

  "/admin/health": [
    {
      title: "Now, and earlier",
      description:
        "The top half is what a deploy pipeline asks: is it working. The bottom half is what a person usually wants — was it working at four o'clock, when the thing they are investigating happened.",
    },
    {
      target: "health-history",
      title: "An outage is a period",
      description:
        "Consecutive unhealthy readings collapse into one incident, so a three-hour outage is not listed as three. Latency is the line; status is the band under it.",
    },
    {
      target: "health-range",
      title: "Any window you like",
      description:
        "Eight hours to thirty days, or an exact range. Long windows are bucketed by taking the *worst* status in each bucket — averaging would round an outage away.",
    },
  ],

  "/admin/flags": [
    {
      title: "Switches that are wired to something",
      description:
        "A flag here changes the platform for the people it names: a feature that is off is not in the navigation and its address is refused, said as “switched off” rather than as a permission refusal.",
    },
    {
      target: "flags-table",
      title: "On for whom",
      description:
        "A rollout is a stable hash of the flag and the person, never a fresh draw — so a feature cannot flicker on and off between requests and leave a bug nobody can reproduce.",
    },
  ],

  "/settings/preferences": [
    {
      title: "Yours, and they travel",
      description:
        "Stored against your account rather than in this browser, so signing in elsewhere brings them with you.",
    },
    {
      target: "pref-notifications",
      title: "How loudly the platform may interrupt",
      description:
        "Separate from whether a notification is *made* — “stop the pop-ups” must not also mean “stop telling me”. At most three appear at once; a burst collapses into one card.",
    },
    {
      target: "format-preview",
      title: "The effect, beside the control",
      description:
        "Every format prints a worked example in the shape you chose. A preference whose result you have to go and look for is one people set by trial.",
    },
  ],

  "/profile": [
    {
      title: "You, as the platform sees you",
      description:
        "The page that answers “why can I not export?” without an administrator: your role, your groups, and which permission came from which.",
    },
    {
      target: "edit-profile",
      title: "Correct your own details",
      description:
        "Your name, how to reach you, what you do and what clock you keep. Not your address or your role — the first proves who you are, the second is somebody else's decision about you.",
    },
    {
      target: "profile-stats",
      title: "Every number opens its rows",
      description:
        "“18 tasks in hand” that cannot be pressed is a number nobody can check — so each of these opens exactly the rows it counted, with the same filter that produced it.",
    },
  ],

  "/showcase/templates": [
    {
      title: "The shapes this template gives you",
      description:
        "Every layout, with a wireframe on the product's own twelve-column grid, what it is built from, and — the half most galleries omit — when it is the wrong answer.",
    },
  ],
};

/**
 * The tour for a path, if there is one.
 *
 * Matched on the longest declared route the path starts with, so
 * `/tasks/abc-123` gets the tasks tour and `/admin/health` is not caught by a
 * shorter `/admin`.
 */
export function tourFor(pathname: string): TourStop[] | undefined {
  let best: string | undefined;
  for (const route of Object.keys(TOURS)) {
    if (
      (pathname === route || pathname.startsWith(`${route}/`)) &&
      (!best || route.length > best.length)
    ) {
      best = route;
    }
  }
  return best ? TOURS[best] : undefined;
}

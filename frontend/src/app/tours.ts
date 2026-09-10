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

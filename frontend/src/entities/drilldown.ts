/**
 * The way back from a drill-down (§44, §72).
 *
 * Every KPI tile, chart segment, map region and quality finding opens the rows
 * behind it with the filters already applied. What was missing is the return:
 * a reader who clicked "AT_RISK" on the dashboard is now on the project list
 * with a filter they did not type, and their way back is the browser's Back
 * button — which, after they have narrowed the list twice, is three presses
 * away and lands somewhere they did not expect.
 *
 * So the drill carries where it came from, in the address:
 *
 *     /projects?f.health=AT_RISK&from=%2Fdashboard%3Fperiod%3Dlast_30_days
 *
 * Three things follow from putting it in the URL rather than in memory:
 *
 * * it **survives a reload**, which a history entry does not describe;
 * * it can be **pasted to a colleague**, who then sees the same list *and*
 *   where the question came from;
 * * and it is **one press back to the picture**, not one press per filter the
 *   reader has changed since.
 *
 * The label is derived from the address rather than passed along with it: two
 * copies of "what to call the dashboard" would disagree, and a link somebody
 * hand-wrote with the wrong label would say so on the page.
 */

/** The parameter that carries it. Short, because it sits in shared links. */
export const ORIGIN_KEY = "from";

/** What a returning link says, by where it goes. */
const NAMES: { prefix: string; label: string }[] = [
  { prefix: "/dashboard", label: "the dashboard" },
  { prefix: "/dashboards", label: "the dashboard" },
  { prefix: "/analytics", label: "the analysis" },
  { prefix: "/maps", label: "the map" },
  { prefix: "/admin/quality", label: "the quality report" },
  { prefix: "/reports", label: "the report" },
  { prefix: "/home", label: "the front page" },
  { prefix: "/find/relationships", label: "the connections" },
  { prefix: "/find/global", label: "the search" },
  { prefix: "/explore", label: "the explorer" },
  { prefix: "/activity", label: "the activity feed" },
  { prefix: "/profile", label: "the profile" },
];

/**
 * The address of a drill-down, carrying where it came from.
 *
 * `origin` is a full address — pathname *and* search — because the picture's
 * own state is part of where the reader was: a dashboard on "last 90 days" is
 * a different place from the same dashboard on "this week".
 */
export function withOrigin(target: string, origin: string): string {
  // An origin that is itself a drill-down keeps only its own address: two
  // levels of `from` in one URL is a stack nobody asked for, and the second
  // hop's way back is the first hop's page.
  const [path = origin, search = ""] = origin.split("?");
  const params = new URLSearchParams(search);
  params.delete(ORIGIN_KEY);
  const cleaned = params.toString() ? `${path}?${params.toString()}` : path;

  const joiner = target.includes("?") ? "&" : "?";
  return `${target}${joiner}${ORIGIN_KEY}=${encodeURIComponent(cleaned)}`;
}

/**
 * Where to go back to, and what to call it — or nothing.
 *
 * Only in-app addresses: a `from` pointing at another site would make any
 * page of this platform a one-click redirect somebody could paste into a
 * message, which is a phishing gadget rather than a convenience (§76).
 */
export function readOrigin(search: string | URLSearchParams): { to: string; label: string } | null {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const raw = params.get(ORIGIN_KEY);
  if (!raw) return null;

  const to = raw.trim();
  // A single leading slash, and no scheme or authority: `//evil.example` is a
  // protocol-relative URL and a browser follows it off-site.
  if (!to.startsWith("/") || to.startsWith("//") || to.includes("://")) return null;

  return { to, label: describeOrigin(to) };
}

/** "the dashboard", or the address itself when nothing better is known. */
export function describeOrigin(to: string): string {
  const path = to.split("?")[0] ?? to;
  // Longest prefix first, so `/find/global` is not read as `/find`.
  const match = [...NAMES]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((name) => path === name.prefix || path.startsWith(`${name.prefix}/`));
  return match?.label ?? path;
}

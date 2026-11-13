/**
 * The insight registry on the client (§43): what each component is, checked at
 * the boundary.
 *
 * The server validates every spec before it is stored, and this checks again
 * before anything is drawn — a saved row from an older version, a hand-edited
 * one, or a future component this build does not know must all be *skipped*,
 * never crash the page. So every node goes through `parseNode`, which returns
 * a typed node or `null`, and the renderer only ever sees typed nodes.
 */

export type Width = "full" | "half" | "third";
export type Format = "number" | "currency" | "percent" | "duration" | "text";
export type Tone = "info" | "success" | "warning" | "danger";

interface Base {
  width: Width;
  title?: string;
  /** A query the server could not run for this viewer — shown in place. */
  error?: string;
}

export interface KpiNode extends Base {
  type: "kpi";
  label: string;
  format: Format;
  hint?: string;
  value: number | string | null;
  previous?: number | null;
  delta?: number | null;
  path?: string;
}
export interface ChartNode extends Base {
  type: "bar" | "line" | "area" | "pie";
  format: Format;
  stacked?: boolean;
  horizontal?: boolean;
  categories: string[];
  series: { name: string; values: (number | null)[] }[];
  path?: string;
}
export interface TableNode extends Base {
  type: "table";
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: Record<string, unknown>[];
}
export interface ListNode extends Base {
  type: "list";
  items: { title: string; subtitle?: string; value?: number | string | null; status?: string | null; href?: string }[];
}
export interface MarkdownNode extends Base {
  type: "markdown";
  text: string;
}
export interface CalloutNode extends Base {
  type: "callout";
  tone: Tone;
  text: string;
}
export interface ProgressNode extends Base {
  type: "progress";
  label: string;
  format: Format;
  hint?: string;
  value: number | null;
  max: number | null;
}
export interface ComparisonNode extends Base {
  type: "comparison";
  format: Format;
  items: { label: string; value: number | null }[];
}
export interface TimelineNode extends Base {
  type: "timeline";
  events: { date: string; title: string; text?: string; tone?: Tone | null; href?: string }[];
}
export interface SectionNode extends Base {
  type: "section";
  blocks: InsightNode[];
}

export type InsightNode =
  | KpiNode
  | ChartNode
  | TableNode
  | ListNode
  | MarkdownNode
  | CalloutNode
  | ProgressNode
  | ComparisonNode
  | TimelineNode
  | SectionNode;

export const REGISTRY = [
  "kpi", "bar", "line", "area", "pie", "table", "list", "markdown", "callout",
  "progress", "comparison", "timeline", "section",
] as const;

type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, limit = 4000): string =>
  typeof value === "string" ? value.slice(0, limit) : typeof value === "number" ? String(value) : "";
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const scalar = (value: unknown): number | string | null =>
  typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" ? value.slice(0, 60) : null;
const width = (value: unknown): Width => (value === "half" || value === "third" ? value : "full");
const format = (value: unknown): Format =>
  value === "currency" || value === "percent" || value === "duration" || value === "text" ? value : "number";
const tone = (value: unknown): Tone =>
  value === "success" || value === "warning" || value === "danger" ? value : "info";
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const href = (value: unknown): string | undefined =>
  typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : undefined;

export function parseNode(raw: unknown, depth = 1): InsightNode | null {
  if (!isObject(raw)) return null;
  const type = raw["type"];
  const data = isObject(raw["data"]) ? raw["data"] : {};
  const base: Base = { width: width(raw["width"]) };
  if (typeof raw["title"] === "string") base.title = text(raw["title"], 200);
  if (typeof raw["error"] === "string") base.error = text(raw["error"], 300);
  switch (type) {
    case "kpi":
      return {
        ...base, type, label: text(raw["label"], 200) || base.title || "", format: format(raw["format"]),
        hint: text(raw["hint"], 200) || undefined,
        value: "value" in data ? scalar(data["value"]) : scalar(raw["value"]),
        previous: num(data["previous"]), delta: num(data["delta"]), path: href(data["path"]),
      };
    case "bar":
    case "line":
    case "area":
    case "pie": {
      const categories = list(data["categories"]).map((c) => text(c, 120));
      const series = list(data["series"]).filter(isObject).map((s) => ({
        name: text(s["name"], 120),
        values: list(s["values"]).map(num),
      }));
      if (!base.error && (!categories.length || !series.length)) return { ...base, type, format: format(raw["format"]), categories: [], series: [] };
      return { ...base, type, format: format(raw["format"]), stacked: raw["stacked"] === true,
               horizontal: raw["horizontal"] === true, categories, series, path: href(data["path"]) };
    }
    case "table":
      return {
        ...base, type,
        columns: list(data["columns"]).filter(isObject).map((c) => ({
          key: text(c["key"], 60), label: text(c["label"], 120), numeric: c["numeric"] === true,
        })),
        rows: list(data["rows"]).filter(isObject).slice(0, 50),
      };
    case "list":
      return {
        ...base, type,
        items: list(data["items"]).filter(isObject).map((i) => ({
          title: text(i["title"], 200), subtitle: text(i["subtitle"], 200) || undefined,
          value: scalar(i["value"]), status: typeof i["status"] === "string" ? i["status"] : null, href: href(i["href"]),
        })),
      };
    case "markdown":
      return raw["text"] ? { ...base, type, text: text(raw["text"]) } : null;
    case "callout":
      return { ...base, type, tone: tone(raw["tone"]), text: text(raw["text"]) };
    case "progress":
      return {
        ...base, type, label: text(raw["label"], 200), format: format(raw["format"]),
        hint: text(raw["hint"], 200) || undefined,
        value: num("value" in data ? data["value"] : raw["value"]), max: num(raw["max"]) ?? num(data["max"]),
      };
    case "comparison":
      return {
        ...base, type, format: format(raw["format"]),
        items: list(data["items"]).filter(isObject).map((i) => ({ label: text(i["label"], 120), value: num(i["value"]) })),
      };
    case "timeline":
      return {
        ...base, type,
        events: list(data["events"]).filter(isObject).map((e) => ({
          date: text(e["date"], 40), title: text(e["title"], 200), text: text(e["text"], 400) || undefined,
          tone: e["tone"] ? tone(e["tone"]) : null, href: href(e["href"]),
        })),
      };
    case "section":
      if (depth >= 2) return null;
      return { ...base, type, blocks: parseBlocks(raw["blocks"], depth + 1) };
    default:
      return null;
  }
}

export function parseBlocks(raw: unknown, depth = 1): InsightNode[] {
  return list(raw)
    .map((node) => parseNode(node, depth))
    .filter((node): node is InsightNode => node !== null);
}

/** A number in the component's format, short enough for a tile. */
export function formatValue(value: number | string | null | undefined, fmt: Format, compact = false): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (fmt === "percent") return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
  if (fmt === "duration") return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} h`;
  // Compact only where it saves room: 2.96 stays 2.96, 1 250 000 becomes 1.3M.
  const options: Intl.NumberFormatOptions = compact && Math.abs(value) >= 10_000
    ? { notation: "compact", maximumFractionDigits: 1 }
    : { maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0 };
  // No currency symbol: the records mix currencies, and a sum labelled "€"
  // would claim a conversion nobody made. The component's label names it.
  return value.toLocaleString(undefined, options);
}

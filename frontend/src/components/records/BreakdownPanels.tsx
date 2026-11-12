/**
 * The glass design's breakdown panels for the record lists (§7).
 *
 * Bars and a stacked strip rather than a chart library: a breakdown of five
 * statuses is read as a list with lengths, and every row is a filter — press
 * one and the list below narrows to it, press it again and it lets go.
 */

import { humanStatus, statusTone, type StatusTone } from "@/components/StatusTag";

export interface Slice {
  name: string;
  value: number;
}

const FILL: Record<StatusTone, string> = {
  ok: "var(--nu-ok-fill)",
  warn: "var(--nu-warn-fill)",
  bad: "var(--nu-bad-fill)",
  acc: "var(--nu-accent)",
  neutral: "rgba(var(--nu-ink-rgb), 0.28)",
};

/** A labelled bar per value, longest first, the top `limit` of them. */
export function BarPanel({
  title,
  series,
  active,
  onSelect,
  limit = 6,
  testId,
}: {
  title: string;
  series: Slice[];
  active?: string | null;
  onSelect: (name: string | null) => void;
  limit?: number;
  testId?: string;
}) {
  // "218 others" is the server's remainder, not a site: it goes last.
  const rest = (item: Slice) => /\bothers?$/i.test(item.name);
  const shown = [...series]
    .sort((a, b) => Number(rest(a)) - Number(rest(b)) || b.value - a.value)
    .slice(0, limit);
  const most = Math.max(1, ...shown.map((item) => item.value));
  return (
    <section className="nx-rec-panel" aria-label={title} data-testid={testId}>
      <h2>{title}</h2>
      <ul className="nx-rec-hbars">
        {shown.map((item) => (
          <li key={item.name}>
            <button
              type="button"
              aria-pressed={active === item.name}
              aria-label={`${humanStatus(item.name)}: ${item.value.toLocaleString()}. Show these.`}
              onClick={() => onSelect(active === item.name ? null : item.name)}
            >
              <span className="nx-rec-hbars-label">{humanStatus(item.name)}</span>
              <span className="nx-rec-bars-track">
                <i style={{ width: `${(item.value / most) * 100}%` }} />
              </span>
              <b>{item.value.toLocaleString()}</b>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One strip split by state, coloured by what each state means, and the list under it. */
export function StatePanel({
  title,
  series,
  active,
  onSelect,
  testId,
}: {
  title: string;
  series: Slice[];
  active?: string | null;
  onSelect: (name: string | null) => void;
  testId?: string;
}) {
  const total = series.reduce((sum, item) => sum + item.value, 0);
  const shown = [...series].sort((a, b) => b.value - a.value);
  return (
    <section className="nx-rec-panel" aria-label={title} data-testid={testId}>
      <h2>{title}</h2>
      <div
        className="nx-rec-strip"
        role="img"
        aria-label={shown.map((item) => `${humanStatus(item.name)} ${item.value}`).join(", ")}
      >
        {shown.map((item) => (
          <span
            key={item.name}
            style={{ flexGrow: item.value, background: FILL[statusTone(item.name)] }}
            title={`${humanStatus(item.name)}: ${item.value.toLocaleString()}`}
          />
        ))}
      </div>
      <ul className="nx-rec-legend">
        {shown.map((item) => (
          <li key={item.name}>
            <button
              type="button"
              aria-pressed={active === item.name}
              onClick={() => onSelect(active === item.name ? null : item.name)}
            >
              <i style={{ background: FILL[statusTone(item.name)] }} />
              <span>{humanStatus(item.name)}</span>
              <b>{item.value.toLocaleString()}</b>
            </button>
          </li>
        ))}
      </ul>
      {total === 0 && <span className="nx-rec-panel-sub">Nothing to count yet.</span>}
    </section>
  );
}

/** A count worth acting on, and the one press that shows the records behind it. */
export function TriageTile({
  count,
  title,
  detail,
  tone,
  onShow,
}: {
  count: number;
  title: string;
  detail: string;
  tone: "bad" | "warn" | "acc";
  onShow: () => void;
}) {
  return (
    <button
      type="button"
      className={`nx-rec-triage nx-rec-triage--${tone}`}
      aria-label={`${count.toLocaleString()} ${title}. ${detail}. Show these.`}
      onClick={onShow}
    >
      <span className="nx-rec-triage-n">{count.toLocaleString()}</span>
      <span className="nx-rec-triage-text">
        <b>{title}</b>
        <span>{detail}</span>
      </span>
      <span className="nx-rec-triage-go">Show these</span>
    </button>
  );
}

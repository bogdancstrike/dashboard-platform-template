/**
 * Small pieces the Records & analytics pages share: the health band pill, a
 * movement figure, a score ring, a KPI tile and an SVG sparkline. Pure and
 * presentational — every number they show comes from the API.
 */
import "@/styles/records-analytics.css";

import type { ReactNode } from "react";

import { BAND_LABEL, type HealthBand } from "@/api/recordsAnalytics";
import { PeoplePicker } from "@/components/PeoplePicker";

export function BandPill({ band, score }: { band: HealthBand | null | undefined; score?: number | null }) {
  if (!band) return <span className="nx-ra-muted">No score</span>;
  return (
    <span className={`nx-ra-band nx-ra-band--${band}`} data-testid="health-band">
      {BAND_LABEL[band]}
      {score !== undefined && score !== null && <b>{score}</b>}
    </span>
  );
}

export function Delta({ value, suffix = "" }: { value: number | null | undefined; suffix?: string }) {
  if (value === null || value === undefined || value === 0) return <span className="nx-ra-muted">±0{suffix}</span>;
  const up = value > 0;
  return (
    <span className={`nx-ra-delta nx-ra-delta--${up ? "up" : "down"}`} aria-label={`${up ? "up" : "down"} ${Math.abs(value)}${suffix}`}>
      {up ? "▲" : "▼"} {Math.abs(value)}
      {suffix}
    </span>
  );
}

export function ScoreRing({ score, band, label = "of 100" }: { score: number; band: HealthBand; label?: string }) {
  return (
    <div
      className={`nx-ra-score nx-ra-score--${band}`}
      style={{ ["--ra-value" as string]: Math.max(0, Math.min(100, score)) }}
      role="img"
      aria-label={`Health score ${score} out of 100, ${BAND_LABEL[band]}`}
    >
      <div>
        <span>
          <b>{score}</b>
          <small>{label}</small>
        </span>
      </div>
    </div>
  );
}

export function Kpi({
  label,
  value,
  hint,
  tone,
  testId,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "ok" | "warn" | "bad";
  testId?: string;
}) {
  return (
    <div className={`nx-ra-kpi${tone ? ` nx-ra-kpi--${tone}` : ""}`} data-testid={testId}>
      <span>{label}</span>
      <b>{value}</b>
      {hint && <small>{hint}</small>}
    </div>
  );
}

/** A filled line of values; flagged indexes are drawn as red dots. */
export function Sparkline({
  values,
  flagged = [],
  height = 44,
  label,
}: {
  values: number[];
  flagged?: number[];
  height?: number;
  label?: string;
}) {
  const width = 240;
  if (values.length < 2) {
    return <svg className="nx-ra-spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label ?? "No data yet"} />;
  }
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg className="nx-ra-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label ?? "Trend"}>
      <path className="area" d={`${line} L${width},${height} L0,${height} Z`} />
      <path className="line" d={line} vectorEffect="non-scaling-stroke" />
      {flagged.map((i) => (values[i] === undefined ? null : <circle key={i} cx={x(i)} cy={y(values[i]!)} r={3.5} />))}
    </svg>
  );
}

export function meterTone(score: number): "ok" | "warn" | "bad" {
  if (score >= 65) return "ok";
  if (score >= 40) return "warn";
  return "bad";
}

/** PeoplePicker as a Form control: tolerates an unset value, optionally keeps one. */
export function PeopleField({
  value,
  onChange,
  single = false,
  label,
}: {
  value?: string[];
  onChange?: (ids: string[]) => void;
  single?: boolean;
  label: string;
}) {
  return (
    <PeoplePicker
      value={value ?? []}
      onChange={(ids) => onChange?.(single ? ids.slice(-1) : ids)}
      multiple={!single}
      aria-label={label}
    />
  );
}

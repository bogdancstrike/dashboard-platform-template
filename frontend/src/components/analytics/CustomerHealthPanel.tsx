/**
 * A customer's health (§12) on their own page: the score and band, how it
 * moved, the trend, and — the point of it — *why*: each signal with its
 * weight, its score and the facts that produced it.
 */
import { useQuery } from "@tanstack/react-query";
import { Segmented, Skeleton } from "antd";
import { useState } from "react";
import { Link } from "react-router-dom";

import { BAND_LABEL, healthApi, type HealthComponent } from "@/api/recordsAnalytics";
import { FailureAlert } from "@/components/FailureAlert";
import { relativeTime } from "@/lib/time";

import { BandPill, Delta, meterTone, ScoreRing } from "./parts";
import { TrendChart } from "./TrendChart";

export function CustomerHealthPanel({ customerId }: { customerId: string }) {
  const [days, setDays] = useState(90);
  const health = useQuery({
    queryKey: ["customer-health", customerId, days],
    queryFn: ({ signal }) => healthApi.customer(customerId, days, signal),
  });

  if (health.isLoading) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (health.isError) return <FailureAlert error={health.error} onRetry={() => void health.refetch()} />;
  const data = health.data!;

  return (
    <div className="nx-ra-stack" data-testid="customer-health">
      <section className="nx-ra-panel">
        <div className="nx-ra-health-hero">
          <ScoreRing score={data.score} band={data.band} />
          <div className="nx-ra-health-hero-text">
            <BandPill band={data.band} />
            <h3>{headline(data.band, data.previous_band)}</h3>
            <div className="nx-ra-sub">
              7 days <Delta value={data.delta_7d} /> · 30 days <Delta value={data.delta_30d} />
              {data.computed_at && <> · scored {relativeTime(data.computed_at)}</>}
            </div>
            {data.previous_band && data.band_changed_at && (
              <div className="nx-ra-muted" style={{ marginTop: 4 }}>
                Was {BAND_LABEL[data.previous_band].toLowerCase()} until {relativeTime(data.band_changed_at)}.
              </div>
            )}
          </div>
          <Link to="/customers/health" className="nx-ra-sub">Portfolio view →</Link>
        </div>
      </section>

      <section className="nx-ra-panel">
        <div className="nx-ra-panel-head">
          <h2>Trend</h2>
          <Segmented
            size="small"
            value={days}
            onChange={(value) => setDays(Number(value))}
            options={[{ label: "30 d", value: 30 }, { label: "90 d", value: 90 }, { label: "1 y", value: 365 }]}
            aria-label="Trend period"
          />
        </div>
        {data.trend.length > 1 ? (
          <TrendChart
            label="Health score"
            yMax={100}
            points={data.trend.map((point) => ({ at: point.day, value: point.score }))}
            bands={[
              { value: data.thresholds.healthy, name: "Healthy" },
              { value: data.thresholds.at_risk, name: "At risk" },
            ]}
          />
        ) : (
          <p className="nx-ra-muted">The trend starts with today's score — check back tomorrow.</p>
        )}
      </section>

      <section className="nx-ra-panel" aria-label="Why this score">
        <div className="nx-ra-panel-head">
          <h2>Why this score</h2>
          <span className="nx-ra-sub">Each signal scores 0–100; the weights decide how much it counts.</span>
        </div>
        <div className="nx-ra-signals">
          {data.components.map((component) => (
            <Signal key={component.key} component={component} />
          ))}
        </div>
      </section>
    </div>
  );
}

function headline(band: string, previous: string | null): string {
  if (band === "CRITICAL") return previous ? "Slipped into critical — act now" : "Critical — this account needs attention";
  if (band === "AT_RISK") return "At risk — worth a conversation";
  return "Healthy — nothing pressing";
}

function Signal({ component }: { component: HealthComponent }) {
  const tone = meterTone(component.score);
  return (
    <article className="nx-ra-signal" data-testid={`signal-${component.key}`}>
      <header>
        <b>{component.label}</b>
        <span>
          weight {component.share}% · adds {component.contribution}
        </span>
      </header>
      <div className="nx-ra-signal-score">{component.score}</div>
      <div className={`nx-ra-meter nx-ra-meter--${tone}`} aria-hidden>
        <i style={{ width: `${component.score}%` }} />
      </div>
      <ul className="nx-ra-facts">
        {component.facts.map((fact) => (
          <li key={fact.text}>
            <span>{fact.text}</span>
            {fact.impact !== 0 && (
              <em className={fact.impact < 0 ? "is-bad" : "is-ok"}>
                {fact.impact > 0 ? "+" : "−"}
                {Math.abs(fact.impact)}
              </em>
            )}
          </li>
        ))}
      </ul>
    </article>
  );
}

import { BAND_LABEL, type HealthPortfolio } from "@/api/recordsAnalytics";
import { EmptyState } from "@/components/EmptyState";
import { PanelHeader } from "@/components/layout/PanelHeader";
import { BandPill } from "@/components/recordsAnalytics/parts";
import { TrendChart } from "@/components/recordsAnalytics/TrendChart";
import { relativeTime } from "@/lib/time";

/** How the portfolio spreads across the bands — each band a filter — and the score histogram. */
export function DistributionPanel({
  data,
  band,
  onBand,
}: {
  data: HealthPortfolio;
  band: string;
  onBand: (band: string | null) => void;
}) {
  return (
    <section className="nx-ra-panel" aria-label="Distribution">
      <PanelHeader title="Distribution" extra={<span className="nx-ra-sub">{data.computed_at ? `Scored ${relativeTime(data.computed_at)}` : "Not scored yet"}</span>} />
      <div className="nx-ra-dist" aria-hidden>
        {data.distribution.map((item) =>
          item.count ? <i key={item.band} className={item.band} style={{ flex: item.count }} /> : null,
        )}
      </div>
      <div className="nx-ra-legend">
        {data.distribution.map((item) => (
          <button
            key={item.band}
            type="button"
            aria-pressed={band === item.band}
            onClick={() => onBand(band === item.band ? null : item.band)}
          >
            <BandPill band={item.band} /> <b>{item.count}</b>
          </button>
        ))}
      </div>
      <TrendChart
        label="Customers"
        kind="bar"
        height={300}
        points={data.histogram.map((bucket) => ({ at: `${bucket.from}–${bucket.to}`, value: bucket.count }))}
        dateFormat={(at) => at}
        format={(v) => String(Math.round(v))}
      />
    </section>
  );
}

/** The customers that recently fell a band — the ones account managers were alerted about. */
export function BandDrops({ drops, onOpen }: { drops: HealthPortfolio["drops"]; onOpen: (id: string) => void }) {
  return (
    <section className="nx-ra-panel" aria-label="Recent band drops">
      <PanelHeader title="Dropped a band" extra={<span className="nx-ra-sub">Account managers were alerted</span>} />
      {drops.length === 0 ? (
        <EmptyState compact title="No recent drops" />
      ) : (
        <div className="nx-ra-rows">
          {drops.map((row) => (
            <div key={row.id} className="nx-ra-row" tabIndex={0} role="link"
              onClick={() => onOpen(row.id)}
              onKeyDown={(e) => e.key === "Enter" && onOpen(row.id)}>
              <div className="nx-ra-row-main">
                <b>{row.name}</b>
                <span>
                  {row.previous_band ? BAND_LABEL[row.previous_band] : "—"} → {BAND_LABEL[row.band]} ·{" "}
                  {relativeTime(row.band_changed_at)}
                </span>
              </div>
              <BandPill band={row.band} score={row.score} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

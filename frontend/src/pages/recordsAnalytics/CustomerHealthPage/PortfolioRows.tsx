import { money, type PortfolioEntry } from "@/api/recordsAnalytics";
import { BandPill, Delta } from "@/components/recordsAnalytics/parts";

export function Movers({ rows, period, onOpen }: { rows: PortfolioEntry[]; period: string; onOpen: (id: string) => void }) {
  if (rows.length === 0) return <p className="nx-ra-muted">Nobody moved much.</p>;
  return (
    <div className="nx-ra-rows">
      {rows.slice(0, 4).map((row) => (
        <PortfolioRow key={row.id} row={row} period={period} onOpen={() => onOpen(row.id)} />
      ))}
    </div>
  );
}

export function PortfolioRow({ row, period, onOpen }: { row: PortfolioEntry; period: string; onOpen: () => void }) {
  return (
    <div className="nx-ra-row" tabIndex={0} role="link" onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen()}>
      <div className="nx-ra-row-main">
        <b>{row.name}</b>
        <span>
          {row.code} · {money(row.lifetime_value)} lifetime
        </span>
      </div>
      <Delta value={period === "7d" ? row.delta_7d : row.delta_30d} />
      <BandPill band={row.band} />
      <span className="nx-ra-row-score">{row.score}</span>
    </div>
  );
}

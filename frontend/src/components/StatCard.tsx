import type { ReactNode } from "react";
import { Card, Tooltip, Typography } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, MinusOutlined } from "@ant-design/icons";

import type { Polarity, Trend } from "@/api/dashboard";
import { SEMANTIC, ACCENT, NEUTRAL } from "@/theme/tokens";

const ACCENTS: Record<string, string> = {
  accent: ACCENT[500],
  success: SEMANTIC.success,
  warning: SEMANTIC.warning,
  danger: SEMANTIC.danger,
  info: SEMANTIC.info,
  neutral: NEUTRAL[500],
};

/**
 * Whether a movement should read as good news.
 *
 * The polarity comes from the server, per metric, because it is a property of
 * the metric and not of the direction: more revenue is good, more SLA breaches
 * is not, and a tile that paints every increase green reports a record number
 * of outages as a success.
 */
function movementColor(trend: Trend, polarity: Polarity): string {
  if (trend === "flat" || polarity === "neutral") return NEUTRAL[500];
  const good = polarity === "up_is_good" ? trend === "up" : trend === "down";
  return good ? SEMANTIC.success : SEMANTIC.danger;
}

function formatValue(value: number, unit: string): string {
  if (unit === "EUR" || unit === "USD" || unit === "GBP") {
    const symbol = unit === "EUR" ? "€" : unit === "GBP" ? "£" : "$";
    // Compact above a million: a KPI tile is 200px wide and "€38,137,905.70"
    // either wraps or gets cut, and neither is a number anyone can read.
    if (Math.abs(value) >= 1_000_000) {
      return `${symbol}${(value / 1_000_000).toLocaleString(undefined, {
        maximumFractionDigits: 1,
      })}M`;
    }
    return `${symbol}${Math.round(value).toLocaleString()}`;
  }
  return value.toLocaleString();
}

export function StatCard({
  label,
  value,
  unit = "",
  icon,
  accent = "accent",
  hint,
  trend,
  polarity = "neutral",
  changePercent,
  previous,
  onClick,
}: {
  label: string;
  value: number;
  unit?: string;
  icon: ReactNode;
  accent?: string;
  hint?: ReactNode;
  trend?: Trend;
  polarity?: Polarity;
  changePercent?: number;
  previous?: number;
  /** Drill-down (§44). Most tiles have one; the ones that do not are rare. */
  onClick?: () => void;
}) {
  const color = ACCENTS[accent] ?? ACCENT[500];
  const moved = trend !== undefined && changePercent !== undefined;
  const movement = moved ? movementColor(trend, polarity) : NEUTRAL[500];
  const Arrow = trend === "up" ? ArrowUpOutlined : trend === "down" ? ArrowDownOutlined : MinusOutlined;

  return (
    <Card
      className="nu-statcard"
      styles={{ body: { padding: 16 } }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `${label}: ${value}. Open the records behind it.` : undefined}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      style={onClick ? { cursor: "pointer" } : undefined}
    >
      <div className="nu-statcard-row">
        <div
          className="nu-statcard-icon"
          style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
          aria-hidden
        >
          {icon}
        </div>
        <div className="nu-statcard-main">
          <div className="nu-statcard-label">{label}</div>
          <div className="nu-statcard-value">
            <span className="nu-statcard-number">{formatValue(value, unit)}</span>
            {moved && (
              <Tooltip
                title={
                  previous !== undefined
                    ? `Previous period: ${formatValue(previous, unit)}`
                    : undefined
                }
              >
                <span
                  className="nu-statcard-delta"
                  style={{
                    color: movement,
                    background: `color-mix(in srgb, ${movement} 13%, transparent)`,
                  }}
                >
                  <Arrow style={{ fontSize: 10 }} />
                  {Math.abs(changePercent).toFixed(1)}%
                </span>
              </Tooltip>
            )}
          </div>
          {hint && (
            <div className="nu-statcard-hint">
              <Typography.Text type="secondary">{hint}</Typography.Text>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

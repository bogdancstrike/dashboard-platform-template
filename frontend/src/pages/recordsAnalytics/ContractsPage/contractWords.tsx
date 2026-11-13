import { Tooltip } from "antd";
import dayjs from "dayjs";

import { type ContractCard } from "@/api/recordsAnalytics";

export type View = "board" | "list" | "forecast" | "calendar";

export const VIEWS: { value: View; label: string }[] = [
  { value: "board", label: "Pipeline" },
  { value: "list", label: "List" },
  { value: "forecast", label: "Forecast" },
  { value: "calendar", label: "Calendar" },
];

export function riskFlag(card: Pick<ContractCard, "at_risk" | "health_band">) {
  return card.at_risk ? (
    <Tooltip title={`Customer health: ${card.health_band === "CRITICAL" ? "critical" : "at risk"}`}>
      <span className="nx-ra-risk" data-testid="at-risk">At risk</span>
    </Tooltip>
  ) : null;
}

export function endsIn(days: number | null): string {
  if (days === null) return "";
  if (days < 0) return `ended ${-days}d ago`;
  if (days === 0) return "ends today";
  return days > 60 ? `ends ${dayjs().add(days, "day").format("D MMM")}` : `ends in ${days}d`;
}

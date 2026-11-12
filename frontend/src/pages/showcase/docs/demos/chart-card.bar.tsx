import type { ChartPanel } from "@/api/dashboard";
import { ChartCard } from "@/components/ChartCard";

const PANEL: ChartPanel = {
  kind: "bar",
  title: "Tickets by severity",
  series: [
    { name: "Critical", value: 4 },
    { name: "High", value: 11 },
    { name: "Normal", value: 26 },
    { name: "Low", value: 7 },
  ],
};

export default function ChartCardBar() {
  return <ChartCard id="docs-bars" height={220} panel={PANEL} />;
}

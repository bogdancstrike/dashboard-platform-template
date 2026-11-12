import { useState } from "react";

import type { ChartPanel } from "@/api/dashboard";
import { ChartKindStrip } from "@/components/charts/ChartKindStrip";
import { ChartPreview } from "@/components/charts/ChartPreview";

const SERIES = [
  { name: "Mon", value: 12 },
  { name: "Tue", value: 19 },
  { name: "Wed", value: 15 },
  { name: "Thu", value: 24 },
  { name: "Fri", value: 21 },
];

export default function ChartPreviewKinds() {
  const [kind, setKind] = useState("bar");
  const panel = { kind, title: "Tickets opened", series: SERIES } as ChartPanel;
  return (
    <div className="nx-doc-col">
      <ChartKindStrip kinds={["bar", "line", "area", "pie"]} value={kind} onChange={setKind} />
      <div className="nx-doc-grid">
        <ChartPreview panel={panel} mode="light" height={170} label="Drawn light" />
        <ChartPreview panel={panel} mode="dark" height={170} label="Drawn dark" />
      </div>
    </div>
  );
}

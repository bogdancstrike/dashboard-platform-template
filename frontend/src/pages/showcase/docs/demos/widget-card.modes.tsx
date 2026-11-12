import { Segmented } from "antd";
import { useState } from "react";

import type { DashboardWidget } from "@/api/dashboards";
import { ChartPreview } from "@/components/charts/ChartPreview";
import { WidgetCard, type WidgetMoves } from "@/components/dashboards/WidgetCard";

const WIDGET: DashboardWidget = {
  id: "demo",
  kind: "BAR_CHART",
  title: "Tickets by severity",
  subtitle: "Last 30 days",
  x: 0,
  y: 0,
  width: 4,
  height: 2,
  position: 0,
  config: { entity: "ticket" },
};

const NO_MOVES: WidgetMoves = { nudge: () => {}, resize: () => {}, setSize: () => {}, edit: () => {}, remove: () => {} };

export default function WidgetCardModes() {
  const [editing, setEditing] = useState(false);
  return (
    <div className="nx-doc-col">
      <Segmented
        aria-label="Widget mode"
        data-testid="widget-mode"
        value={editing ? "editing" : "reading"}
        onChange={(next) => setEditing(next === "editing")}
        options={[
          { value: "reading", label: "Reading" },
          { value: "editing", label: "Rearranging" },
        ]}
      />
      <div style={{ maxWidth: 380, height: 200 }}>
        <WidgetCard widget={WIDGET} editable={editing} columns={12} moves={NO_MOVES}>
          <ChartPreview
            panel={{ kind: "bar", title: "Tickets", series: [{ name: "Critical", value: 4 }, { name: "High", value: 11 }, { name: "Normal", value: 26 }] }}
            height={120}
          />
        </WidgetCard>
      </div>
    </div>
  );
}

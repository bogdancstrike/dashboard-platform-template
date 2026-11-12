import { Segmented } from "antd";
import { useState } from "react";

export default function SegmentedBasic() {
  const [period, setPeriod] = useState("24h");
  return (
    <div className="nx-doc-col">
      <Segmented
        aria-label="Window"
        value={period}
        onChange={(value) => setPeriod(String(value))}
        options={[
          { value: "8h", label: "8 hours" },
          { value: "24h", label: "24 hours" },
          { value: "7d", label: "7 days" },
          { value: "30d", label: "30 days" },
          { value: "custom", label: "Custom", disabled: true },
        ]}
      />
      <span className="nx-doc-muted">Chosen: {period}. One of N is always a Segmented, never a strip of radio buttons.</span>
    </div>
  );
}

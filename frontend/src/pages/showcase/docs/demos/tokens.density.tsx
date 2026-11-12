import { Button, Input, Segmented } from "antd";

import { useAppearance } from "@/theme/AppearanceProvider";
import { DENSITY, DENSITY_LABEL, DENSITY_ZOOM, type Density } from "@/theme/tokens";

export default function TokensDensity() {
  const { density, setDensity } = useAppearance();
  return (
    <div className="nx-doc-col">
      <Segmented
        aria-label="Density"
        value={density}
        onChange={(value) => setDensity(value)}
        options={(Object.keys(DENSITY) as Density[]).map((key) => ({ value: key, label: DENSITY_LABEL[key] }))}
      />
      <div className="nx-doc-row">
        <Input placeholder="A field at this density" aria-label="Sample field" style={{ maxWidth: 240 }} />
        <Button type="primary">A button</Button>
      </div>
      <span className="nx-doc-muted">
        {DENSITY_LABEL[density]}: zoom {DENSITY_ZOOM[density]}, controls {DENSITY[density].controlHeight}px, text{" "}
        {DENSITY[density].fontSize}px. This changes the whole app — the same choice as the account menu.
      </span>
    </div>
  );
}

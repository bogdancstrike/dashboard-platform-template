import { useState } from "react";

import { CollapseAllToggle } from "@/components/CollapseAllToggle";

const GROUPS = ["Overview", "Find", "Analyse", "Work"];

export default function CollapseAllBasic() {
  const [folded, setFolded] = useState<Set<string>>(new Set(["Find"]));
  return (
    <div className="nx-doc-col" style={{ maxWidth: 280 }}>
      <div className="nx-doc-row" style={{ justifyContent: "space-between" }}>
        <b>Sections</b>
        <CollapseAllToggle
          label="sections"
          allCollapsed={folded.size === GROUPS.length}
          onToggle={(collapse) => setFolded(collapse ? new Set(GROUPS) : new Set())}
        />
      </div>
      {GROUPS.map((group) => (
        <span key={group} className="nx-doc-muted">
          {folded.has(group) ? "▸" : "▾"} {group}
        </span>
      ))}
    </div>
  );
}

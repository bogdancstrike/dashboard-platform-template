import { EdgeTag } from "@/components/EdgeTag";
import { SERIES } from "@/theme/tokens";

export default function EdgeTagColours() {
  return (
    <div className="nx-doc-row">
      {["Administrator", "Manager", "Operator", "Analyst", "Viewer"].map((role, index) => (
        <EdgeTag key={role} color={SERIES[index % SERIES.length]}>
          {role}
        </EdgeTag>
      ))}
      <EdgeTag color={null}>Unassigned</EdgeTag>
    </div>
  );
}

import { Tooltip } from "antd";

import { ChartKindIcon } from "@/components/icons/ChartKindIcon";
import type { ChartShape } from "@/components/charts/shapes";

/**
 * One kind in the gallery: the picture, its name, and why it is unavailable.
 *
 * A disabled button rather than an absent one, with the missing piece named —
 * the reader learns that the kind exists and what would unlock it (§76).
 */
export function Thumbnail({
  shape,
  missing,
  chosen,
  onChoose,
}: {
  shape: ChartShape;
  missing: string | null;
  chosen: boolean;
  onChoose: () => void;
}) {
  const className = ["nu-gallery-item", chosen ? "is-chosen" : "", missing ? "is-blocked" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <Tooltip title={missing ? `${shape.label} ${missing}` : shape.question}>
      <button
        type="button"
        className={className}
        aria-pressed={chosen}
        aria-label={missing ? `${shape.label} — ${missing}` : `${shape.label} — ${shape.question}`}
        disabled={Boolean(missing)}
        onClick={onChoose}
        data-testid={`chart-kind-${shape.kind}`}
      >
        <span className="nu-gallery-canvas">
          <ChartKindIcon kind={shape.kind} />
        </span>
        <span className="nu-gallery-label">{shape.label}</span>
      </button>
    </Tooltip>
  );
}

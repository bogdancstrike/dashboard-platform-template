import type { WidgetKind } from "@/api/dashboards";

import { FAMILY_LABELS, KINDS, KIND_FAMILIES, kindsOf } from "../../kinds";

/**
 * The first step of adding a widget: the kinds as a grid of tiles, shelf by
 * shelf. *What it shows* is the one decision a reader recognises faster as a
 * picture than as a row in a dropdown.
 */
export function KindTiles({
  kinds,
  current,
  onPick,
}: {
  /** The kinds on offer, already filtered by feature flag. */
  kinds: WidgetKind[];
  current: WidgetKind;
  onPick: (kind: WidgetKind) => void;
}) {
  return (
    <div className="nx-ov-kindgrid" data-testid="widget-kind-tiles">
      {KIND_FAMILIES.map((family) => {
        const offered = kindsOf(family, kinds);
        if (offered.length === 0) return null;
        return (
          <section key={family} className="nx-ov-kindgrid-family">
            <h3>{FAMILY_LABELS[family].label}</h3>
            <div className="nx-ov-kindgrid-tiles">
              {offered.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`nx-ov-kindtile${item === current ? " is-on" : ""}`}
                  aria-label={`${KINDS[item].label} — ${KINDS[item].question}`}
                  title={KINDS[item].question}
                  data-testid={`widget-tile-${item}`}
                  onClick={() => onPick(item)}
                >
                  <span className="nx-ov-kindtile-icon" style={{ color: KINDS[item].colour }}>
                    {KINDS[item].icon}
                  </span>
                  <span className="nx-ov-kindtile-label">{KINDS[item].label}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

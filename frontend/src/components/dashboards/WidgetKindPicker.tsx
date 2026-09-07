/**
 * Choosing what a dashboard will hold, before it exists (§45).
 *
 * A grid of kinds, each with a counter, because "how many headline numbers"
 * is a real question and a checkbox cannot answer it. Following QSINT: the
 * card carries an icon, what the kind is called and the *question it answers*,
 * so somebody who does not know what a heatmap is for can still choose one.
 *
 * Two decisions worth stating.
 *
 * **A count, not a checkbox.** Four KPI tiles across the top is the commonest
 * dashboard there is, and a picker that can only say "yes" to KPI makes that
 * four separate trips through the builder.
 *
 * **A maximum per kind, and it is reached rather than warned about.** Eight
 * headline numbers is a dashboard; twenty is a wall. The plus stops being
 * available, which teaches the limit without an error message.
 */

import { Badge, Button, Tooltip, Typography } from "antd";
import { MinusOutlined, PlusOutlined } from "@ant-design/icons";

import type { WidgetKind } from "@/api/dashboards";

import { KINDS, KIND_ORDER } from "./kinds";

const { Text } = Typography;

export function WidgetKindPicker({
  chosen,
  onChange,
  /** Kinds the reader cannot use yet — they have saved no report, say. */
  unavailable = {},
}: {
  /** In order, so the layout the server builds is the order they were picked. */
  chosen: WidgetKind[];
  onChange: (next: WidgetKind[]) => void;
  unavailable?: Partial<Record<WidgetKind, string>>;
}) {
  const counts = chosen.reduce<Partial<Record<WidgetKind, number>>>((tally, kind) => {
    tally[kind] = (tally[kind] ?? 0) + 1;
    return tally;
  }, {});

  const add = (kind: WidgetKind) => {
    if ((counts[kind] ?? 0) >= KINDS[kind].maximum) return;
    onChange([...chosen, kind]);
  };

  const drop = (kind: WidgetKind) => {
    // The last one of that kind, so removing does not reorder what is left.
    const last = chosen.lastIndexOf(kind);
    if (last < 0) return;
    onChange(chosen.filter((_item, index) => index !== last));
  };

  return (
    <div className="nu-kinds" data-testid="widget-kind-picker">
      {KIND_ORDER.map((kind) => {
        const spec = KINDS[kind];
        const count = counts[kind] ?? 0;
        const blocked = unavailable[kind];
        const full = count >= spec.maximum;

        return (
          <Tooltip key={kind} title={blocked ?? spec.question}>
            <div
              className={`nu-kind${count > 0 ? " is-chosen" : ""}${blocked ? " is-blocked" : ""}`}
              style={
                count > 0
                  ? { borderColor: spec.colour, background: `color-mix(in srgb, ${spec.colour} 10%, transparent)` }
                  : undefined
              }
            >
              <button
                type="button"
                className="nu-kind-face"
                disabled={Boolean(blocked) || full}
                aria-label={blocked ? `${spec.label} — ${blocked}` : `Add ${spec.label}`}
                onClick={() => add(kind)}
                data-testid={`kind-${kind}`}
              >
                <span className="nu-kind-icon" style={{ color: spec.colour }}>
                  {spec.icon}
                </span>
                <span className="nu-kind-label">{spec.label}</span>
                <span className="nu-kind-question">{blocked ?? spec.question}</span>
              </button>

              {count > 0 && (
                <div className="nu-kind-counter">
                  <Button
                    size="small"
                    type="text"
                    aria-label={`One fewer ${spec.label}`}
                    icon={<MinusOutlined />}
                    onClick={() => drop(kind)}
                  />
                  <Badge count={count} color={spec.colour} />
                  <Tooltip title={full ? `At most ${spec.maximum} of these` : ""}>
                    <Button
                      size="small"
                      type="text"
                      disabled={full}
                      aria-label={`One more ${spec.label}`}
                      icon={<PlusOutlined />}
                      onClick={() => add(kind)}
                    />
                  </Tooltip>
                </div>
              )}
            </div>
          </Tooltip>
        );
      })}
      {chosen.length === 0 && (
        <Text type="secondary" className="nu-kinds-hint">
          Pick at least one. A dashboard is created in order to hold something.
        </Text>
      )}
    </div>
  );
}

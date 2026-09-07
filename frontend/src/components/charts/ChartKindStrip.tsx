/**
 * How shall this be drawn — as a strip of icons in the chart's own header.
 *
 * The report builder asked this with a `Segmented` control of seven *words*
 * ("bar hbar line area pie stacked-bar treemap"), inside the question form,
 * where it overflowed its card and got cut off at "treemap". Three things were
 * wrong: the names are the API's kind keys rather than anything a person says,
 * a word strip needs four hundred pixels to offer what icons offer in two
 * hundred, and the kind is not part of the question at all — it is a property
 * of the picture, so it belongs on the picture.
 *
 * The labels come from `shapes.ts`, which is also where the renderer's
 * requirements are declared, so a kind cannot be offered here under a name
 * nothing else uses.
 */

import { Segmented, Tooltip } from "antd";
import {
  AreaChartOutlined,
  BarChartOutlined,
  DotChartOutlined,
  LineChartOutlined,
  PieChartOutlined,
  RadarChartOutlined,
} from "@ant-design/icons";

import type { ChartKind } from "@/api/dashboard";

import { shapeFor } from "./shapes";

/**
 * An icon per kind.
 *
 * AntD has no icon for a treemap, a funnel or a stacked bar; the nearest
 * honest one is used rather than inventing a glyph nobody recognises, and the
 * label is one hover away in every case.
 */
const ICONS: Partial<Record<ChartKind, React.ReactNode>> = {
  bar: <BarChartOutlined />,
  hbar: <BarChartOutlined rotate={90} />,
  line: <LineChartOutlined />,
  area: <AreaChartOutlined />,
  pie: <PieChartOutlined />,
  "stacked-bar": <BarChartOutlined />,
  treemap: <DotChartOutlined />,
  scatter: <DotChartOutlined />,
  radar: <RadarChartOutlined />,
};

export function ChartKindStrip({
  kinds,
  value,
  onChange,
}: {
  kinds: readonly ChartKind[];
  value: string;
  onChange: (kind: string) => void;
}) {
  return (
    <Segmented
      size="small"
      aria-label="Visualization"
      className="nu-kind-strip"
      value={value}
      onChange={(next) => onChange(String(next))}
      options={kinds.map((kind) => {
        const label = shapeFor(kind)?.label ?? kind;
        return {
          value: kind,
          // The kind key is kept as the `title`, because that is what the URL
          // carries and what a test addresses.
          label: (
            <Tooltip title={label}>
              <span aria-label={label} title={kind} className="nu-kind-icon">
                {ICONS[kind] ?? <BarChartOutlined />}
              </span>
            </Tooltip>
          ),
        };
      })}
    />
  );
}

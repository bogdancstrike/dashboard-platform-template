import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { Typography } from "antd";

import { useAppearance } from "@/theme/AppearanceProvider";

import type { ChartNode } from "../spec";
import { chartOption } from "./chartOption";

const { Text } = Typography;

export function Chart({ node, height }: { node: ChartNode; height: number }) {
  const { chartTheme: theme } = useAppearance();
  const option = useMemo(() => chartOption(node, theme), [node, theme]);
  if (!node.categories.length) return <Text type="secondary">No records match.</Text>;
  return (
    <div data-testid="insight-chart" data-kind={node.type}>
      <ReactECharts
        option={option}
        style={{ height, width: "100%" }}
        notMerge
        lazyUpdate
        opts={{ renderer: "canvas" }}
      />
    </div>
  );
}

/** The organisation dashboard's vocabulary: icons, chart shapes, drill-downs, severities, and the width hook. */

import { useEffect, useRef, useState } from "react";
import {
  ApiOutlined,
  CheckSquareOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  DeploymentUnitOutlined,
  DollarOutlined,
  ExclamationCircleOutlined,
  FolderOutlined,
  FundOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
  UserOutlined,
  WarningOutlined,
} from "@ant-design/icons";

import { type ChartKind, type ChartPanel, type DashboardAlert } from "@/api/dashboard";

/** Backend icon name → the glyph that stands for it. */
export const ICONS: Record<string, React.ReactNode> = {
  euro: <DollarOutlined />,
  "shopping-cart": <ShoppingCartOutlined />,
  users: <TeamOutlined />,
  user: <UserOutlined />,
  "life-buoy": <ApiOutlined />,
  "alert-triangle": <WarningOutlined />,
  "check-square": <CheckSquareOutlined />,
  clock: <ClockCircleOutlined />,
  folder: <FolderOutlined />,
  activity: <FundOutlined />,
  cpu: <DeploymentUnitOutlined />,
  "x-circle": <CloseCircleOutlined />,
  shield: <ExclamationCircleOutlined />,
};

/**
 * How much room each chart kind needs.
 *
 * A twenty-four-column heatmap squeezed into a third of the width is a smear;
 * a gauge given two thirds is mostly whitespace. Sizing by kind rather than by
 * position also means adding a panel does not reshuffle the ones after it.
 */
export const SHAPES: Partial<Record<ChartKind, { span: number; height: number }>> = {
  area: { span: 16, height: 280 },
  "stacked-area": { span: 16, height: 280 },
  "stacked-bar": { span: 8, height: 280 },
  funnel: { span: 8, height: 260 },
  hbar: { span: 16, height: 260 },
  "multi-line": { span: 16, height: 260 },
  gauge: { span: 8, height: 260 },
  heatmap: { span: 24, height: 260 },
  scatter: { span: 12, height: 300 },
  "stacked-hbar": { span: 12, height: 300 },
  pie: { span: 8, height: 240 },
  radar: { span: 8, height: 300 },
  treemap: { span: 16, height: 300 },
  bar: { span: 8, height: 240 },
  line: { span: 8, height: 240 },
};

/**
 * Which list a chart's category drills into (§44).
 *
 * A chart nobody can click through is a picture. Only the panels whose
 * categories *are* a filter value are listed; a revenue trend has no such
 * category, and inventing one would send the reader somewhere arbitrary.
 */
export const DRILL_DOWN: Record<string, string> = {
  revenue_by_channel: "/orders?f.channel=",
  tickets_by_category: "/tickets?f.category=",
  tasks_by_status: "/tasks?f.status=",
  projects_by_health: "/projects?f.health=",
  device_health: "/devices?f.kind=",
};

/**
 * Severity → the AntD tag preset that carries it.
 *
 * A *preset* rather than one of our own hexes, and that is the fix rather than
 * the shortcut: a custom `color` makes AntD paint the fill and write white on
 * it, and white on our amber is 2.87:1 — an alert tag a reader cannot read,
 * which is the one tag on the page that matters. The presets are tinted
 * grounds with ink text, and the global stylesheet already names the readable half of
 * the ramp for each of them (§55). `processing` is the preset for informational
 * blue; there is no `info` one.
 */
export const SEVERITY: Record<DashboardAlert["severity"], string> = {
  CRITICAL: "error",
  WARNING: "warning",
  INFO: "processing",
};

/** A panel with nothing to draw — moved into a compact strip at the end. */
export function isEmptyPanel(panel: ChartPanel): boolean {
  return (
    panel.series.length === 0 ||
    panel.series.every((point) => !point.value && point.x === undefined)
  );
}

/** Watch an element's width. */
export function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

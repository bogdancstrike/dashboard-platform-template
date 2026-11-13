/** The reports page's vocabulary and helpers. */

import { Tag } from "antd";
import { GlobalOutlined, LockOutlined, TeamOutlined } from "@ant-design/icons";

import type { SavedReport } from "@/api/reports";

/** What each visibility looks like, so the state is read rather than deduced. */
/** `preset` and not `colour`: these are AntD preset *names*, whose ink
 * the global stylesheet (`styles/global`) fixes. A field called colour is where a hex ends up, and a hex
 * on a `Tag` is a filled tag with white text on it (§55) — see `EdgeTag`. */
export const SCOPES: Record<string, { icon: React.ReactNode; label: string; preset?: string }> = {
  PRIVATE: { icon: <LockOutlined />, label: "Private" },
  SHARED: { icon: <TeamOutlined />, label: "Shared", preset: "blue" },
  PUBLIC: { icon: <GlobalOutlined />, label: "Public", preset: "green" },
};

export function ScopeTag({ report }: { report: SavedReport }) {
  const scope = SCOPES[report.scope] ?? SCOPES["PRIVATE"]!;
  return (
    <Tag icon={scope.icon} color={scope.preset} bordered={false}>
      {scope.label}
    </Tag>
  );
}

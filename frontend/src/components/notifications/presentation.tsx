import type { ReactNode } from "react";
import {
  AlertOutlined,
  AuditOutlined,
  BarChartOutlined,
  BellOutlined,
  CheckCircleOutlined,
  MessageOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  UserSwitchOutlined,
} from "@ant-design/icons";

import { statusColor } from "@/theme/tokens";

/**
 * How a notification is drawn, decided in one place.
 *
 * The bell and the page render the same rows, and a category that is a
 * message icon in the dropdown and a bell in the list is two products. Colour
 * comes from the shared status palette for the same reason — `CRITICAL` is one
 * red across the notification centre, the dashboard alert strip and the table.
 */
const CATEGORY_ICONS: Record<string, ReactNode> = {
  MENTION: <MessageOutlined />,
  ASSIGNMENT: <UserSwitchOutlined />,
  APPROVAL: <CheckCircleOutlined />,
  SYSTEM: <SettingOutlined />,
  SECURITY: <SafetyCertificateOutlined />,
  REPORT: <BarChartOutlined />,
  AUDIT: <AuditOutlined />,
  ALERT: <AlertOutlined />,
};

export function categoryIcon(category: string | null | undefined): ReactNode {
  return CATEGORY_ICONS[String(category ?? "").toUpperCase()] ?? <BellOutlined />;
}

/** Severity drives the colour; the category only ever drives the glyph. */
export function severityColor(severity: string | null | undefined): string {
  return statusColor(severity);
}

/** "ASSIGNMENT" → "Assignment". Enum spellings belong in the payload, not on screen. */
export function humanise(value: string | null | undefined): string {
  const text = String(value ?? "").replace(/_/g, " ").toLowerCase();
  return text ? text[0]!.toUpperCase() + text.slice(1) : "";
}

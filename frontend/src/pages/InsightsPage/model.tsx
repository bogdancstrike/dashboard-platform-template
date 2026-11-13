/** The insights page's scopes. */

import { GlobalOutlined, LockOutlined, TeamOutlined } from "@ant-design/icons";

export const SCOPE = {
  PRIVATE: { label: "Only me", icon: <LockOutlined /> },
  SHARED: { label: "Shared", icon: <TeamOutlined /> },
  PUBLIC: { label: "Everyone", icon: <GlobalOutlined /> },
} as const;

export const SOURCE: Record<string, string> = {
  ai: "Built by AI",
  suggested: "Suggested",
  fallback: "Composed without AI",
};

/**
 * Insights (§43): ask a question about the records, get a page built from a
 * fixed set of components with the numbers bound in.
 *
 * The address carries what is open: `?insight=<id>` for a saved one (pushed),
 * `?draft=1` while a fresh answer is on screen (pushed, so back returns to the
 * gallery). A draft lives in memory until it is saved.
 */

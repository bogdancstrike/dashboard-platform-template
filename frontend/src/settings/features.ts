/**
 * Feature flags, read (§27).
 *
 * The catalogue of flags lives on the server (`backend/src/core/
 * feature_catalogue.py`): it seeds the rows, gates the API, the background
 * jobs and the live channel, and tells the administration screen what each
 * flag takes away. This file names the same keys and the same routes, and
 * `backend/tests/test_feature_flags.py` fails when the two disagree.
 *
 * Four decisions.
 *
 * **The answer comes from the server, with the profile.** `/api/me` publishes
 * a map of every flag and whether it is on for *this* reader, computed by the
 * same function the API gates with. The rollout rule is never reimplemented
 * here — a browser that decided its own percentage would disagree with the
 * API that refuses the call.
 *
 * **A flag gates a feature, never a permission.** Turning `bulk-operations`
 * off takes the tick boxes away; it does not make somebody unable to delete a
 * record they may delete. And the flags screen itself is never gated, or an
 * administrator could switch off their own way back.
 *
 * **A flag nobody has created gates nothing.** The profile publishes a map, so
 * an absent key reads as *ungated* rather than off — a page gated on a flag
 * that does not exist yet must not vanish. While the profile loads the answer
 * is the same, so half the navigation does not blink out for a frame.
 *
 * **Changes apply live.** `useFeatureSync` (mounted once by the shell)
 * refetches the profile when the server announces a flag change on the live
 * channel, when an API call comes back `feature_disabled`, on focus, and on a
 * poll while the live channel is down.
 */

import { createElement, Fragment, useEffect, type ComponentType, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { setFeatureDisabledHandler } from "@/api/client";
import { useOptionalAuth } from "@/auth/AuthProvider";
import { useLive, useLiveEvents } from "@/live/LiveProvider";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Every flag the product reads, by the name the code uses for it.
 *
 * Declared rather than typed as strings at call sites: this is the list
 * somebody consults to find out whether a flag *does* anything.
 */
export const FEATURES = {
  // Overview
  dashboardBuilder: "dashboard-builder",
  approvals: "approvals",
  onboarding: "onboarding",
  // AI
  ai: "ai",
  aiAssistant: "ai-assistant",
  aiPageHelp: "ai-page-help",
  aiDailyBrief: "ai-daily-brief",
  aiFilters: "ai-filters",
  aiInsights: "ai-insights",
  aiDocuments: "ai-documents",
  aiSummaries: "ai-summaries",
  // Find
  advancedSearch: "advanced-search",
  savedViews: "saved-views",
  globalSearch: "global-search",
  relationships: "relationships",
  catalog: "catalog",
  favorites: "favorites",
  // Analyse
  analytics: "analytics",
  reports: "reports",
  reportBuilder: "report-builder",
  reportScheduling: "report-scheduling",
  chartBuilder: "chart-builder",
  maps: "maps",
  anomalyAlerts: "anomaly-alerts",
  publicDashboards: "public-dashboards",
  // Work
  kanbanBoard: "kanban-board",
  timeline: "timeline",
  sprints: "sprints",
  recurringTasks: "recurring-tasks",
  workflows: "workflows",
  workflowCanvas: "workflow-canvas",
  webhooks: "webhooks",
  calendar: "calendar",
  mail: "mail",
  files: "files",
  timeTracking: "time-tracking",
  // Collaboration
  chat: "chat",
  docs: "docs",
  meetingNotes: "meeting-notes",
  // Records
  customerHealth: "customer-health",
  contracts: "contracts",
  versionHistory: "version-history",
  spreadsheetGrid: "spreadsheet-grid",
  slaPolicies: "sla-policies",
  forms: "forms",
  publicForms: "public-forms",
  // Data
  csvImport: "csv-import",
  exports: "exports",
  bulkOperations: "bulk-operations",
  // Platform
  commandPalette: "command-palette",
  liveUpdates: "live-updates",
  impersonation: "impersonation",
  liveLogStream: "live-log-stream",
  darkMode: "dark-mode",
  // Developers
  developerPortal: "developer-portal",
} as const;

export type FeatureKey = (typeof FEATURES)[keyof typeof FEATURES];

/**
 * Routes a flag takes away: the shell answers them with the switched-off page.
 * Same paths as the server catalogue's `routes`, as React Router spells them.
 */
export const ROUTE_FLAGS: Record<string, FeatureKey> = {
  "/dashboards": "dashboard-builder",
  "/dashboards/:id": "dashboard-builder",
  "/approvals": "approvals",
  "/onboarding": "onboarding",
  "/assistant": "ai-assistant",
  "/assistant/:conversationId": "ai-assistant",
  "/ai/insights": "ai-insights",
  "/ai/documents": "ai-documents",
  "/search/saved": "saved-views",
  "/search/saved/:searchId": "saved-views",
  "/find/global": "global-search",
  "/find/relationships": "relationships",
  "/find/catalog": "catalog",
  "/favorites": "favorites",
  "/analytics": "analytics",
  "/reports": "reports",
  "/reports/builder": "report-builder",
  "/charts/builder": "chart-builder",
  "/maps": "maps",
  "/alerts": "anomaly-alerts",
  "/alerts/:id": "anomaly-alerts",
  "/kanban": "kanban-board",
  "/timeline": "timeline",
  "/sprints": "sprints",
  "/workflows": "workflows",
  "/workflows/:ruleId/canvas": "workflow-canvas",
  "/calendar": "calendar",
  "/mail": "mail",
  "/files": "files",
  "/time": "time-tracking",
  "/chat": "chat",
  "/chat/:channelId": "chat",
  "/docs": "docs",
  "/docs/:pageId": "docs",
  "/customers/health": "customer-health",
  "/contracts": "contracts",
  "/contracts/:id": "contracts",
  "/tasks/grid": "spreadsheet-grid",
  "/projects/grid": "spreadsheet-grid",
  "/tickets/grid": "spreadsheet-grid",
  "/customers/grid": "spreadsheet-grid",
  "/orders/grid": "spreadsheet-grid",
  "/devices/grid": "spreadsheet-grid",
  "/admin/sla": "sla-policies",
  "/admin/forms": "forms",
  "/admin/forms/:id": "forms",
  "/import": "csv-import",
  "/exports": "exports",
  "/developers": "developer-portal",
  "/developers/:tab": "developer-portal",
};

/** Parents: a child is only on when its parent is (mirrors the catalogue). */
const PARENTS: Partial<Record<FeatureKey, FeatureKey[]>> = {
  "ai-assistant": ["ai"],
  "ai-page-help": ["ai"],
  "ai-daily-brief": ["ai"],
  "ai-filters": ["ai"],
  "ai-insights": ["ai"],
  "ai-documents": ["ai"],
  "ai-summaries": ["ai"],
  "report-scheduling": ["reports"],
  "public-dashboards": ["dashboard-builder"],
  "workflow-canvas": ["workflows"],
  webhooks: ["workflows"],
  "meeting-notes": ["docs"],
  "public-forms": ["forms"],
};

const ROUTE_PATTERNS = Object.entries(ROUTE_FLAGS).map(([route, key]) => ({
  key,
  test: new RegExp(`^${route.replace(/:[A-Za-z]+/g, "[^/]+")}/?$`),
  // Static paths outrank parameterised ones: `/customers/health` is not a
  // customer called "health".
  weight: route.split("/").filter((part) => part && !part.startsWith(":")).length * 10 - (route.match(/:/g)?.length ?? 0),
}));

/** The flag a path is behind, or undefined when no flag governs it. */
export function flagForPath(pathname: string): FeatureKey | undefined {
  let best: { key: FeatureKey; weight: number } | undefined;
  for (const pattern of ROUTE_PATTERNS) {
    if (pattern.test.test(pathname) && (!best || pattern.weight > best.weight)) best = pattern;
  }
  return best?.key;
}

/** The flag a navigation item is behind: its own, or its route's. */
export function navItemFlag(item: { key: string; flag?: string }): FeatureKey | undefined {
  return (item.flag as FeatureKey | undefined) ?? flagForPath(item.key);
}

/** Whether `key` is on in a feature map — ungated when absent, parents count. */
export function featureOn(flags: Record<string, boolean> | undefined, key: FeatureKey): boolean {
  if (!flags) return true;
  if (flags[key] === false) return false;
  return (PARENTS[key] ?? []).every((parent) => featureOn(flags, parent));
}

/** Whether one feature is on for the signed-in reader. */
export function useFeature(key: FeatureKey): boolean {
  // Outside an AuthProvider (a component rendered on its own) nothing is gated.
  const profile = useOptionalAuth()?.profile;
  return featureOn(profile?.features, key);
}

/** Several at once, for a component that gates more than one thing. */
export function useFeatures(): (key: FeatureKey) => boolean {
  const flags = useOptionalAuth()?.profile?.features;
  return (key: FeatureKey) => featureOn(flags, key);
}

/** Render `children` only while `flag` is on (and `fallback` otherwise). */
export function Feature({ flag, children, fallback = null }: { flag: FeatureKey; children: ReactNode; fallback?: ReactNode }) {
  return createElement(Fragment, null, useFeature(flag) ? children : fallback);
}

/**
 * The same component, rendered only while `flag` is on.
 *
 * A wrapper rather than an early `return null` inside the component, so the
 * component's own hooks are never skipped when a flag flips mid-session.
 */
export function withFeature<P extends object>(flag: FeatureKey, Component: ComponentType<P>): ComponentType<P> {
  function Gated(props: P) {
    return useFeature(flag) ? createElement(Component, props) : null;
  }
  Gated.displayName = `withFeature(${flag})(${Component.displayName ?? (Component.name || "Component")})`;
  return Gated;
}

/** How often the profile is refetched while the live channel is down. */
export const FEATURE_POLL_MS = 60_000;

/**
 * Keep the feature map current without a reload. Mounted once, by the shell.
 */
export function useFeatureSync(): void {
  const queryClient = useQueryClient();
  const live = useLive();
  const refetch = () => void queryClient.invalidateQueries({ queryKey: queryKeys.me() });

  useLiveEvents((message) => {
    if (message.type === "features.changed") refetch();
  });

  useEffect(() => {
    // A call refused as switched off means the map this tab holds is stale.
    setFeatureDisabledHandler(refetch);
    return () => setFeatureDisabledHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient]);

  useEffect(() => {
    if (!live.shouldPoll) return undefined;
    const timer = window.setInterval(refetch, FEATURE_POLL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.shouldPoll, queryClient]);
}

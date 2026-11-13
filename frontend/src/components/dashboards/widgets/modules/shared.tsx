/** What every module widget body shares: its props, its loading and empty states, and the link to its page. */

import { Skeleton } from "antd";
import { Link } from "react-router-dom";

import type { DashboardWidget } from "@/api/dashboards";
import type { ExplorerResource } from "@/api/explorer";
import { EmptyState } from "@/components/EmptyState";

/** Rows a module widget shows. More than this and it is a page, not a card. */
export const ROWS = 6;

/** Every module body takes the same two things: the widget, and the catalogue. */
export interface ModuleBodyProps {
  widget: DashboardWidget;
  resources: ExplorerResource[];
  /** Drawn in place when a module answers with a refusal or an error. */
  fallback: (error: Error, subject: string) => JSX.Element;
}

/**
 * A loading state the size of the answer.
 *
 * Every module body uses it, so a dashboard mid-load is a grid of cards
 * settling rather than a grid of spinners of five different sizes.
 */
export function Loading() {
  return <Skeleton active title={false} paragraph={{ rows: 4 }} />;
}

export function Nothing({ what }: { what: string }) {
  return <EmptyState compact title={what} />;
}

/** The footer every module carries: the whole of it, one press away. */
export function MoreLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="nu-widget-more">
      {children}
    </Link>
  );
}

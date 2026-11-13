import "@/styles/decisions.css";

import type { ComponentType } from "react";
import { useSearchParams } from "react-router-dom";

import { useAuth } from "@/auth/AuthProvider";
import { PageHeader } from "@/components/PageHeader";

import { EntriesView } from "./EntriesView";
import { ReportsView } from "./ReportsView";
import { TeamView } from "./TeamView";
import { WeekView } from "./WeekView";
import type { Go, Tab } from "./timeCopy";

interface TabView {
  key: Tab;
  label: string;
  /** Only offered to a reader who approves time. */
  approvers?: boolean;
  View: ComponentType<{ params: URLSearchParams; go: Go }>;
}

/** The page's tabs, in order; each is a view of the same address. */
const TABS: TabView[] = [
  { key: "week", label: "My week", View: WeekView },
  { key: "entries", label: "Entries", View: EntriesView },
  { key: "team", label: "Team", approvers: true, View: TeamView },
  { key: "reports", label: "Reports", View: ReportsView },
];

/**
 * Time & timesheets: the week grid, every entry, the team's weeks and reports.
 *
 * The tab and the week are places (pushed onto history, so back walks them);
 * the report's range and grouping are filters (replaced).
 */
export default function TimePage() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const canApprove = auth.can("time.approve");
  const raw = params.get("tab") as Tab | null;
  const tab: Tab = raw && ["week", "entries", "team", "reports"].includes(raw)
    ? (raw === "team" && !canApprove ? "week" : raw)
    : "week";

  const go = (next: Record<string, string | null>, replace = false) => {
    const copy = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") copy.delete(key);
      else copy.set(key, value);
    }
    setParams(copy, { replace });
  };

  return (
    <div className="nx-td" data-testid="time-page">
      <PageHeader
        title={<>Time &amp; <em>timesheets</em></>}
        subtitle="Timers, the week you submit, and where the hours went."
      />
      <div className="nx-td-chips" role="tablist" aria-label="Time views">
        {TABS.filter((item) => !item.approvers || canApprove).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`nx-td-chip${tab === key ? " is-on" : ""}`}
            onClick={() => go({ tab: key === "week" ? null : key, user: key === "week" ? params.get("user") : null })}
            data-testid={`time-tab-${key}`}
          >
            {label}
          </button>
        ))}
      </div>
      {TABS.filter((item) => item.key === tab).map(({ key, View }) => (
        <View key={key} params={params} go={go} />
      ))}
    </div>
  );
}

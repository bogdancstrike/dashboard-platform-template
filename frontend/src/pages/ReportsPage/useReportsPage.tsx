/** What the page reads, what it keeps in the address, and what it derives. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { reportsApi } from "@/api/reports";
import type { DashboardSubject } from "@/components/dashboards/AddToDashboard";
import { usePageCommands } from "@/commands/CommandContext";
import { FEATURES, useFeature } from "@/settings/features";
import { queryKeys } from "@/lib/queryKeys";

/** The page's state, queries and actions. */
export function useReportsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const [params, setParams] = useSearchParams();
  const [term, setTerm] = useState("");
  /** The report on its way to a dashboard, or nothing (§45). */
  const [pinning, setPinning] = useState<DashboardSubject | null>(null);
  // "Add to a dashboard" is the dashboard builder's (§27).
  const dashboardsOn = useFeature(FEATURES.dashboardBuilder);

  const reports = useQuery({
    queryKey: queryKeys.reports(),
    queryFn: ({ signal }) => reportsApi.list(signal),
  });

  // Memoised because the filter below depends on it: a fresh `[]` on every
  // render would re-filter the list on every keystroke elsewhere on the page.
  const items = useMemo(() => reports.data?.items ?? [], [reports.data]);
  const openId = params.get("report") ?? items[0]?.id ?? "";
  const open = items.find((item) => item.id === openId);

  const [which, setWhich] = useState<"all" | "scheduled" | "mine" | "shared">("all");
  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase();
    const narrowed = items.filter((item) =>
      which === "scheduled"
        ? Boolean(item.schedule)
        : which === "mine"
          ? item.can_edit
          : which === "shared"
            ? !item.can_edit
            : true,
    );
    if (!needle) return narrowed;
    return narrowed.filter((item) =>
      [item.name, item.description ?? "", item.owner.name, item.resource_type]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [items, term, which]);

  const run = useQuery({
    queryKey: queryKeys.reportRun(openId),
    queryFn: ({ signal }) => reportsApi.run(openId, {}, signal),
    enabled: Boolean(openId),
    placeholderData: (previous) => previous,
  });

  const choose = (id: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("report", id);
        return next;
      },
      // Pushed: each report opened is a place back returns to.
      { replace: false },
    );

  const duplicate = useMutation({
    mutationFn: (id: string) => reportsApi.duplicate(id),
    onSuccess: (copy) => {
      message.success(`${copy.name} is yours to change`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports() });
      choose(copy.id);
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That report could not be copied."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => reportsApi.remove(id),
    onSuccess: () => {
      message.success("Report deleted");
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports() });
      setParams(new URLSearchParams(), { replace: true });
    },
    onError: (error) =>
      message.error(
        error instanceof ApiError ? error.message : "That report could not be deleted.",
      ),
  });

  usePageCommands("reports", [
    {
      id: "reports.new",
      label: "Build a report",
      keywords: "new create analysis",
      run: () => navigate("/reports/builder"),
    },
    {
      id: "reports.rerun",
      label: "Run this report again",
      keywords: "refresh reload",
      run: () => void run.refetch(),
    },
  ]);

  const canCreate = reports.data?.can_create ?? false;

  /** Re-run the open report over a different period, without saving it. */
  async function rerun(period: string) {
    if (!open) return;
    const result = await reportsApi.run(open.id, { period });
    queryClient.setQueryData(queryKeys.reportRun(open.id), result);
  }

  return {
    navigate,
    message,
    modal,
    term,
    setTerm,
    pinning,
    setPinning,
    dashboardsOn,
    reports,
    items,
    openId,
    open,
    which,
    setWhich,
    filtered,
    run,
    choose,
    duplicate,
    remove,
    canCreate,
    rerun,
  };
}

export type ReportsPageData = ReturnType<typeof useReportsPage>;

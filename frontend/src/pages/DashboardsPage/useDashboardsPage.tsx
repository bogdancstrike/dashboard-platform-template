/** What the page reads, what it keeps in the address, and what it derives. */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { analysisApi } from "@/api/analysis";
import { dashboardsApi, type DashboardWidget, type WidgetKind } from "@/api/dashboards";
import { explorerApi } from "@/api/explorer";
import { reportsApi } from "@/api/reports";
import { usePageCommands } from "@/commands/CommandContext";
import { asText } from "@/lib/text";
import { useSmartBack } from "@/app/history";
import { STALE, queryKeys } from "@/lib/queryKeys";
import { applyParamChanges } from "@/hooks/useUrlState";

import { useDashboardWrites } from "./useDashboardWrites";
import { widgetMoves } from "./widgetMoves";

/** The page's state, queries and actions. */
export function useDashboardsPage() {
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const [params, setParams] = useSearchParams();
  /**
   * Every place on this page is in the address, pushed, so back and forward
   * walk through them: the open dashboard, Customize, the widget editor and
   * its two steps. `pushes` counts the entries this page added for the widget
   * editor, so closing it steps back over them rather than leaving them for
   * the back button to reopen.
   */
  const navigate = useNavigate();
  const back = useSmartBack();
  const pushes = useRef(0);
  const place = (changes: Record<string, string | null>, replace = false) =>
    setParams((current) => applyParamChanges(current, changes), { replace });
  const widgetParam = params.get("widget");
  const chosenKind = (params.get("wkind") as WidgetKind | null) ?? null;
  useEffect(() => {
    if (!widgetParam) pushes.current = 0;
    else if (!chosenKind) pushes.current = Math.min(pushes.current, 1);
  }, [widgetParam, chosenKind]);
  const setWidgetForm = (next: DashboardWidget | "new" | null) => {
    if (next === null) {
      if (pushes.current > 0) {
        const steps = pushes.current;
        pushes.current = 0;
        navigate(-steps);
      } else {
        place({ widget: null, wkind: null }, true);
      }
      return;
    }
    pushes.current = 1;
    place({ widget: next === "new" ? "new" : next.id, wkind: null });
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const listing = useQuery({
    queryKey: queryKeys.dashboards(),
    queryFn: ({ signal }) => dashboardsApi.list(signal),
  });

  const items = listing.data?.items ?? [];

  // The gallery's own narrowing: by name, by whose it is, in an order. Local,
  // because the listing is every dashboard this reader can see already.
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "name" | "size">("recent");
  const [owner, setOwner] = useState<"any" | "me" | "shared">("any");
  const needle = query.trim().toLowerCase();
  const shown = items
    .filter((item) => !needle || item.name.toLowerCase().includes(needle))
    .filter((item) => owner === "any" || (owner === "me" ? item.can_edit : !item.can_edit))
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "size"
          ? b.widget_count - a.widget_count
          : String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")),
    );
  // Only what the URL names. No dashboard is opened by default, because the
  // gallery *is* the landing state — and a page that silently opens one is a
  // page whose address does not describe what is on screen (§69).
  const openId = params.get("dashboard") ?? "";

  /**
   * Whether the layout editor is open, remembered per dashboard (§72).
   *
   * Not in the URL and not on the server, because it is neither: a colleague
   * opening the same address should not land in an editor, and the owner
   * reloading mid-rearrange should not be dropped back into reading mode with
   * the drawer they had open gone. Per dashboard rather than per page, because
   * "I am building this one" and "I am reading that one" are true at once.
   */
  const editing = params.get("edit") === "1";
  const setEditing = (on: boolean) => place({ edit: on ? "1" : null });

  const dashboard = useQuery({
    queryKey: queryKeys.dashboard(openId),
    queryFn: ({ signal }) => dashboardsApi.get(openId, signal),
    enabled: Boolean(openId),
  });

  // What a widget may group by and measure, and which datasets exist. Read
  // once for the whole grid rather than once per widget.
  const catalogue = useQuery({
    queryKey: queryKeys.analysisCatalogue(),
    queryFn: ({ signal }) => analysisApi.catalogue(signal),
    staleTime: STALE.long,
  });
  const resources = useQuery({
    queryKey: queryKeys.explorerCatalogue(),
    queryFn: ({ signal }) => explorerApi.catalogue(signal),
    staleTime: STALE.long,
  });

  // Whether the reader has anything to point a `REPORT` or `SEARCH` widget at.
  // Asked once for the page rather than per card, and only to decide what the
  // picker may offer.
  const savedReports = useQuery({
    queryKey: queryKeys.reports(),
    queryFn: ({ signal }) => reportsApi.list(signal),
    staleTime: STALE.long,
  });
  const savedSearches = useQuery({
    queryKey: queryKeys.savedSearches("all"),
    queryFn: ({ signal }) => explorerApi.saved(undefined, signal),
    staleTime: STALE.long,
  });

  const open = (id: string) =>
    place({ dashboard: id || null, edit: null, widget: null, wkind: null });

  const { settled, saveBoard, removeBoard, saveWidget, dropWidget, arrange, duplicate } =
    useDashboardWrites({
      openId,
      open,
      setParams,
      setSettingsOpen,
      setWidgetForm,
    });

  const board = dashboard.data;
  const columns = board?.columns ?? listing.data?.columns ?? 12;
  const widgets = board?.widgets ?? [];
  const widgetForm: DashboardWidget | "new" | null =
    widgetParam === "new" ? "new" : (widgets.find((item) => item.id === widgetParam) ?? null);
  /**
   * The window the chart-shaped widgets read over.
   *
   * There is deliberately **no period control on this page**. A dashboard here
   * is a set of windows onto the product — what is in the inbox, what is in
   * the lane, what lands this week — and almost none of that has a period at
   * all; offering one above them implied every card answered to it, and put a
   * prominent control on a page where most of the widgets ignored it. The
   * charts that do need a window take the dashboard's saved default, which
   * lives in Settings where an owner sets it once, and any widget may name its
   * own (§45).
   */
  const period = asText(board?.filters["period"]) || "last_30_days";

  const moves = widgetMoves({ widgets, columns, arrange, dropWidget, modal, setWidgetForm });

  usePageCommands("dashboards", [
    {
      id: "dashboards.new",
      label: "Create a dashboard",
      keywords: "add build layout",
      run: () => setWizardOpen(true),
    },
    {
      id: "dashboards.edit",
      label: "Rearrange this dashboard",
      keywords: "edit widgets move",
      run: () => setEditing(true),
    },
    {
      id: "dashboards.home",
      label: "Make this my home dashboard",
      keywords: "default landing",
      run: () => saveBoard.mutate({ is_home: true }),
    },
  ]);

  const canCreate = listing.data?.can_create ?? false;

  // The two kinds that draw something the reader already made. Offered and
  // refused with the reason rather than hidden, so somebody learns that a
  // saved chart can become a widget (§76).
  const unavailable: Partial<Record<WidgetKind, string>> = {
    ...(savedReports.data?.total === 0 ? { REPORT: "You have not saved a report yet" } : {}),
    ...(savedSearches.data?.total === 0 ? { SEARCH: "You have not saved a search yet" } : {}),
  };

  return {
    queryClient,
    message,
    modal,
    navigate,
    back,
    pushes,
    place,
    chosenKind,
    setWidgetForm,
    settingsOpen,
    setSettingsOpen,
    shareOpen,
    setShareOpen,
    wizardOpen,
    setWizardOpen,
    listing,
    items,
    query,
    setQuery,
    sort,
    setSort,
    owner,
    setOwner,
    shown,
    openId,
    editing,
    setEditing,
    dashboard,
    catalogue,
    resources,
    open,
    settled,
    saveBoard,
    removeBoard,
    saveWidget,
    arrange,
    duplicate,
    board,
    columns,
    widgets,
    widgetForm,
    period,
    moves,
    canCreate,
    unavailable,
  };
}

export type DashboardsPageData = ReturnType<typeof useDashboardsPage>;

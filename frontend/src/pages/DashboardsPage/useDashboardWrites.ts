/** Every write the dashboards page makes: the board, its widgets, its layout, a copy. */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import type { SetURLSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import {
  dashboardsApi,
  type DashboardWidget,
  type Placement,
  type SavedDashboard,
  type WidgetInput,
} from "@/api/dashboards";
import { queryKeys } from "@/lib/queryKeys";

/** The page's mutations, each refreshing the layout it changed and the list beside it. */
export function useDashboardWrites({
  openId,
  open,
  setParams,
  setSettingsOpen,
  setWidgetForm,
}: {
  openId: string;
  open: (id: string) => void;
  setParams: SetURLSearchParams;
  setSettingsOpen: (open: boolean) => void;
  setWidgetForm: (next: DashboardWidget | "new" | null) => void;
}) {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  /** Every write refreshes the layout it changed, and the list beside it. */
  const settled = (saved: SavedDashboard) => {
    queryClient.setQueryData(queryKeys.dashboard(saved.id), saved);
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboards() });
  };

  const failed = (error: unknown) =>
    message.error(error instanceof ApiError ? error.message : "That change was not saved.");

  const saveBoard = useMutation({
    mutationFn: (input: Parameters<typeof dashboardsApi.update>[1]) =>
      dashboardsApi.update(openId, input),
    onSuccess: (saved) => {
      settled(saved);
      setSettingsOpen(false);
    },
    onError: failed,
  });

  const removeBoard = useMutation({
    mutationFn: () => dashboardsApi.remove(openId),
    onSuccess: (gone) => {
      message.success(`${gone.name} deleted`);
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete("dashboard");
          return next;
        },
        { replace: true },
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboards() });
    },
    onError: failed,
  });

  const saveWidget = useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: WidgetInput }) =>
      id ? dashboardsApi.updateWidget(openId, id, input) : dashboardsApi.addWidget(openId, input),
    onSuccess: (saved) => {
      settled(saved);
      setWidgetForm(null);
    },
    onError: failed,
  });

  const dropWidget = useMutation({
    mutationFn: (widgetId: string) => dashboardsApi.removeWidget(openId, widgetId),
    onSuccess: settled,
    onError: failed,
  });

  /**
   * One drag's worth of geometry, applied here first and then confirmed.
   *
   * The layout is already on the server the moment a gesture ends — that is
   * what makes it survive a refresh. What this adds is the half-second in
   * between: without it the card snaps back to where it was until the response
   * lands, which reads as the drag having failed and makes people drag again.
   *
   * The cache is written, not a second copy of the layout, so a refused move
   * still snaps back: `onError` restores what the server last said, and
   * `onSettled` refetches. A local layout that outlived the refusal would be a
   * dashboard that looks rearranged and is not (§73).
   */
  const arrange = useMutation({
    mutationFn: (placements: Placement[]) => dashboardsApi.arrange(openId, placements),
    onMutate: async (placements: Placement[]) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.dashboard(openId) });
      const previous = queryClient.getQueryData<SavedDashboard>(queryKeys.dashboard(openId));
      if (previous?.widgets) {
        const geometry = new Map(placements.map((item) => [item.id, item]));
        queryClient.setQueryData<SavedDashboard>(queryKeys.dashboard(openId), {
          ...previous,
          widgets: previous.widgets.map((widget) => {
            const placed = geometry.get(widget.id);
            return placed
              ? { ...widget, x: placed.x, y: placed.y, width: placed.width, height: placed.height }
              : widget;
          }),
        });
      }
      return { previous };
    },
    onSuccess: settled,
    onError: (error, _placements, context) => {
      if (context?.previous)
        queryClient.setQueryData(queryKeys.dashboard(openId), context.previous);
      failed(error);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(openId) }),
  });

  /** A colleague's layout, adopted as your own so you can adapt it. */
  const duplicate = useMutation({
    mutationFn: (id: string) => dashboardsApi.duplicate(id),
    onSuccess: (saved) => {
      settled(saved);
      open(saved.id);
      message.success(`Copied as ${saved.name} — it is yours to change`);
    },
    onError: failed,
  });

  return { settled, saveBoard, removeBoard, saveWidget, dropWidget, arrange, duplicate };
}

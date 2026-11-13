import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { favoritesApi, type RecentVisit } from "@/api/favorites";
import { usePageCommands } from "@/commands/CommandContext";
import { errorText } from "@/lib/errors";
import { formatNumber } from "@/lib/formats";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Favourites' state: the bookmarks and the recent visits, the kind filter, and removing, reordering, starring and clearing.
 */
export function useFavoritesPage() {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [kind, setKind] = useState<string>("all");

  const bookmarks = useQuery({
    queryKey: queryKeys.favorites("list"),
    queryFn: ({ signal }) => favoritesApi.list(signal),
  });
  const recents = useQuery({
    queryKey: queryKeys.favorites("recents"),
    queryFn: ({ signal }) => favoritesApi.recents(signal),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.favorites() });
  };

  const removed = useMutation({
    mutationFn: (id: string) => favoritesApi.remove(id),
    onSuccess: async () => {
      await refresh();
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "change your favourites" }));
    },
  });

  const arranged = useMutation({
    mutationFn: (order: string[]) => favoritesApi.arrange(order),
    onSuccess: async () => {
      await refresh();
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "rearrange your favourites" }));
    },
  });

  const starred = useMutation({
    mutationFn: (row: RecentVisit) =>
      row.is_favorite
        ? Promise.reject(new Error("unstar from the list above"))
        : favoritesApi.add({
            resource_type: row.resource_type,
            resource_id: row.resource_id,
            label: row.label,
            url: row.url,
            ...(row.icon ? { icon: row.icon } : {}),
          }),
    onSuccess: async () => {
      await refresh();
      message.success("Kept.");
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "keep that" }));
    },
  });

  const cleared = useMutation({
    mutationFn: () => favoritesApi.clearRecents(),
    onSuccess: async (answer) => {
      await refresh();
      message.success(
        answer.cleared === 0
          ? "There was nothing to forget."
          : `${formatNumber(answer.cleared)} forgotten. Your favourites are untouched.`,
      );
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "clear that" }));
    },
  });

  usePageCommands("favorites", [
    {
      id: "favorites.clear-recents",
      label: "Forget what I have looked at",
      keywords: "recents clear history forget visited",
      run: () => cleared.mutate(),
    },
    {
      id: "favorites.bookmarks",
      label: "Show only what I starred",
      keywords: "bookmarks starred favorites kept mine",
      run: () => setKind("all"),
    },
    {
      id: "favorites.refresh",
      label: "Check for anything new",
      keywords: "refresh reload update recents",
      run: () => {
        void bookmarks.refetch();
        void recents.refetch();
      },
    },
    {
      id: "favorites.explore",
      label: "Find something to star",
      keywords: "explore records search browse datasets",
      run: () => navigate("/explore"),
    },
  ]);

  const list = bookmarks.data;
  const items = (list?.items ?? []).filter(
    (item) => kind === "all" || item.resource_type === kind,
  );

  return { message, queryClient, navigate, kind, setKind, bookmarks, recents, refresh, removed, arranged, starred, cleared, list, items };
}

export type FavoritesPageModel = ReturnType<typeof useFavoritesPage>;

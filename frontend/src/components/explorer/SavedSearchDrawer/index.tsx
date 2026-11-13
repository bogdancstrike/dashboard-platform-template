/**
 * Saved searches, as a module of the search screen rather than a page (§5).
 *
 * Each card says what the search asks, who owns it and who can see it, because
 * those are the three things that decide whether to open somebody else's saved
 * search or duplicate it. The actions available on a card are exactly the ones
 * the API will allow: a member sees Open and Duplicate, an owner also sees
 * Edit, Favourite and Delete. Offering an action that returns 403 teaches
 * people to distrust the whole panel.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Drawer, Input, List } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";

import { URL_OVERLAY } from "@/app/history";
import { explorerApi, type SavedSearch } from "@/api/explorer";
import { AddToDashboard, type DashboardSubject } from "@/components/dashboards/AddToDashboard";
import { COPY_MEANS, confirmCopy } from "@/lib/confirm";
import { EmptyState } from "@/components/EmptyState";
import { FEATURES, useFeature } from "@/settings/features";
import { queryKeys } from "@/lib/queryKeys";

import { SavedSearchCard } from "./SavedSearchCard";

export interface SavedSearchDrawerProps {
  open: boolean;
  resourceType: string;
  onClose: () => void;
  onOpen: (search: SavedSearch) => void;
  /** Opens the editor for a search the caller owns. */
  onEdit: (search: SavedSearch) => void;
  /** Back to the drawer this one was opened from ("← Rules"). */
  onBack?: () => void;
  backLabel?: string;
}

export function SavedSearchDrawer({
  open,
  resourceType,
  onClose,
  onOpen,
  onEdit,
  onBack,
  backLabel,
}: SavedSearchDrawerProps) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");
  /** The search on its way to a dashboard, or nothing (§45). */
  const [pinning, setPinning] = useState<DashboardSubject | null>(null);
  const dashboardsOn = useFeature(FEATURES.dashboardBuilder);

  const query = useQuery({
    queryKey: queryKeys.savedSearches(resourceType),
    queryFn: ({ signal }) => explorerApi.saved(resourceType, signal),
    enabled: open && Boolean(resourceType),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.savedSearches(resourceType) });

  const openSearch = useMutation({
    mutationFn: (id: string) => explorerApi.openSaved(id),
    // `onOpen` restores the whole question, panel included — it closes this
    // drawer by leaving it out. Calling `onClose` as well would write the URL
    // a second time, from the state as it was before the search was loaded.
    onSuccess: (search) => onOpen(search),
    onError: (error: Error) => message.error(error.message),
  });
  const duplicate = useMutation({
    mutationFn: explorerApi.duplicateSaved,
    onSuccess: async () => { await refresh(); message.success("Private copy created"); },
    onError: (error: Error) => message.error(error.message),
  });
  const remove = useMutation({
    mutationFn: explorerApi.deleteSaved,
    onSuccess: async () => { await refresh(); message.success("Saved search deleted"); },
    onError: (error: Error) => message.error(error.message),
  });
  const favourite = useMutation({
    mutationFn: ({ item, value }: { item: SavedSearch; value: boolean }) =>
      explorerApi.updateSaved(item.id, { is_favorite: value }),
    onSuccess: refresh,
    onError: (error: Error) => message.error(error.message),
  });

  // Filtered here, not on the server: the list is one person's saved searches,
  // and a round trip to narrow a dozen cards would be slower than typing.
  const needle = term.trim().toLowerCase();
  const items = (query.data?.items ?? []).filter((item) =>
    !needle ||
    [item.name, item.description ?? "", item.condition_text ?? "", item.owner.name]
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );

  return (
    <Drawer
      open={open}
      width={560}
      rootClassName={URL_OVERLAY}
      title={
        onBack ? (
          <span className="nx-fd-backtitle">
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack} data-testid="saved-back">
              {backLabel ?? "Back"}
            </Button>
            <span>Saved searches</span>
          </span>
        ) : (
          "Saved searches"
        )
      }
      onClose={onClose}
    >
      <Input.Search
        allowClear
        aria-label="Filter saved searches"
        placeholder="Filter by name, condition or owner…"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        style={{ marginBottom: 12 }}
      />
      <List
        loading={query.isLoading}
        dataSource={items}
        locale={{
          emptyText: (
            <EmptyState compact title={needle ? "No saved search matches that" : "No saved searches for this dataset"} />
          ),
        }}
        renderItem={(item) => {
          return (
            <List.Item>
              <SavedSearchCard
                item={item}
                dashboardsOn={dashboardsOn}
                opening={openSearch.isPending && openSearch.variables === item.id}
                onOpen={() => openSearch.mutate(item.id)}
                onFavourite={() => favourite.mutate({ item, value: !item.is_favorite })}
                onEdit={() => onEdit(item)}
                onPin={() => setPinning({ kind: "SEARCH", id: item.id, title: item.name })}
                onDuplicate={() =>
                  confirmCopy(modal, {
                    what: item.name,
                    consequence:
                      "The question is copied as it stands. " + COPY_MEANS,
                    onOk: () => duplicate.mutateAsync(item.id),
                  })
                }
                onRemove={() => remove.mutate(item.id)}
              />
            </List.Item>
          );
        }}
      />
      <AddToDashboard
        open={pinning !== null}
        subject={pinning}
        onClose={() => setPinning(null)}
      />
    </Drawer>
  );
}

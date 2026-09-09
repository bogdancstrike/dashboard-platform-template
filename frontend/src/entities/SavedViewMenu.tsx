/**
 * The saved views of one entity list (§46).
 *
 * A *view* is a question plus how the answer is laid out, and this template
 * keeps exactly one store for that: the saved searches of §5. This menu is
 * what makes them reachable from the six entity lists rather than only from
 * the Data Explorer — because "the queue I look at every morning" is a thing
 * somebody wants on `/tickets`, not on a page they have to remember exists.
 *
 * Four decisions worth the reader's attention.
 *
 * **One store, not two.** The model layer also carries a `saved_views` table,
 * and serving this menu from it would mean two rows that both answer "how do I
 * look at tickets" and no rule about which wins. A saved search already stores
 * the filters, the term, the sort, the page size and the mode; a list needs
 * nothing more.
 *
 * **A view built in the Data Explorer's rule builder is offered as a link.**
 * A nested tree of ANDs and ORs is not expressible in a row of facet selects,
 * so applying one *as* those selects would show a different set of rows under
 * its name. `fitsAList` decides, and the ones that do not fit open in
 * `/explore` where they were built.
 *
 * **The default is applied on arrival and beaten by the address.** That rule
 * lives in `useEntityView`, where the URL does; this menu only sets the flag.
 *
 * **Saving is the dialog the Data Explorer uses.** Naming, describing and
 * sharing a view asks the same questions wherever it is saved from, and a
 * second dialog here would be the one that quietly forgets sharing.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Dropdown, Tag, Typography, type MenuProps } from "antd";
import {
  CheckOutlined,
  DownOutlined,
  NodeIndexOutlined,
  PushpinOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import { explorerApi, type SaveSearchInput, type SavedSearch } from "@/api/explorer";
import { SavedSearchForm } from "@/components/explorer/SavedSearchForm";
import { fitsAList, type EntityView } from "@/entities/useEntityView";

const { Text } = Typography;

/**
 * The page sizes a saved search may carry.
 *
 * The server's set, deliberately duplicated as a constant rather than guessed
 * at: a card grid pages in twelves and twenty-fours because that is what fills
 * its rows, and saving one of those as a view would be a 400 the reader cannot
 * act on. Snapped to the nearest allowed size instead — a view is about the
 * question, and a card grid decides its own rows anyway.
 */
export const PAGE_SIZES = [10, 25, 50, 100, 200] as const;

export function nearestPageSize(size: number): number {
  return PAGE_SIZES.reduce((best, option) =>
    Math.abs(option - size) < Math.abs(best - size) ? option : best,
  );
}

/** What this list currently shows, in the shape a saved search stores. */
export function snapshotOf(view: EntityView): Omit<SaveSearchInput, "name"> | null {
  const request = view.request;
  if (!request) return null;
  // The request always carries columns; the type says it may not, and a saved
  // search with none is refused by the server — so an empty set is "nothing to
  // save" rather than a 400 the reader cannot act on.
  const columns = request.columns ?? view.resource?.default_columns ?? [];
  if (columns.length === 0) return null;
  return {
    resource_type: request.resource_type,
    // A list has no rule builder, and saying so is what keeps the view
    // applicable to a list afterwards.
    condition_tree: null,
    filters: view.filters,
    query_text: view.term,
    sort: view.sort,
    order: view.order,
    columns,
    page_size: nearestPageSize(view.pageSize),
    view_mode: "table",
  };
}

/** "3 filters · sorted by due date" — what a reader is about to save. */
export function describeSnapshot(view: EntityView): string {
  const parts: string[] = [];
  const count = Object.keys(view.filters).length;
  if (count) parts.push(`${count} filter${count === 1 ? "" : "s"}`);
  if (view.term) parts.push(`“${view.term}”`);
  parts.push(`sorted by ${view.sort.replace(/_/g, " ")}`);
  return parts.join(" · ");
}

export function SavedViewMenu({ view }: { view: EntityView }) {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const resourceKey = view.resource?.key;
  const items = view.views.data?.items ?? [];
  const applied = items.find((item) => item.id === view.viewId);
  const snapshot = snapshotOf(view);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["saved-searches", resourceKey] });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<SaveSearchInput> }) =>
      explorerApi.updateSaved(id, body),
    onSuccess: async (saved, variables) => {
      await refresh();
      message.success(
        "is_default" in variables.body
          ? variables.body.is_default
            ? `“${saved.name}” is what this list will open with`
            : `“${saved.name}” is no longer the default`
          : `“${saved.name}” updated`,
      );
    },
    onError: (error: Error) => message.error(error.message),
  });

  if (!resourceKey || !snapshot) return null;

  const open = (chosen: SavedSearch) => {
    if (fitsAList(chosen)) {
      view.applyView(chosen);
      // Counted where every other opening is counted, so "used 40 times" means
      // the same thing on both pages. Deliberately not awaited: the rows are
      // already loading from the address this just wrote.
      void explorerApi.openSaved(chosen.id);
      return;
    }
    navigate(`/explore?saved=${chosen.id}`);
  };

  const menu: MenuProps["items"] = [
    ...(items.length
      ? [
          {
            type: "group" as const,
            label: "Saved views",
            children: items.map((item) => ({
              key: `view:${item.id}`,
              icon: item.id === view.viewId
                ? <CheckOutlined />
                : fitsAList(item)
                  ? undefined
                  : <NodeIndexOutlined />,
              label: (
                <span className="nu-view-item">
                  <span className="nu-view-name">{item.name}</span>
                  {item.is_default && item.can_edit && (
                    <Tag bordered={false} color="blue">
                      default
                    </Tag>
                  )}
                  {!item.can_edit && <Text type="secondary">{item.owner.name}</Text>}
                </span>
              ),
            })),
          },
          { type: "divider" as const },
        ]
      : []),
    ...(view.viewId || view.filterCount
      ? [{ key: "clear", label: "Show everything" }]
      : []),
    {
      // The group's label says what "this view" currently *is*, because
      // "Update Morning queue" is a destructive-feeling action and the reader
      // deserves to know what they are about to overwrite it with.
      type: "group" as const,
      label: describeSnapshot(view),
      children: [
        {
          key: "save",
          icon: <SaveOutlined />,
          label: applied?.can_edit ? "Save as a new view…" : "Save this view…",
        },
        ...(applied?.can_edit
          ? [
              { key: "overwrite", label: `Update “${applied.name}”` },
              {
                key: "default",
                icon: <PushpinOutlined />,
                label: applied.is_default
                  ? "Stop opening with this view"
                  : "Open this list with this view",
              },
            ]
          : []),
      ],
    },
  ];

  const onClick: MenuProps["onClick"] = ({ key }) => {
    if (key.startsWith("view:")) {
      const chosen = items.find((item) => `view:${item.id}` === key);
      if (chosen) open(chosen);
      return;
    }
    if (key === "clear") return view.applyView(null);
    if (key === "save") return setSaving(true);
    if (key === "overwrite" && applied) {
      return update.mutate({ id: applied.id, body: snapshot });
    }
    if (key === "default" && applied) {
      return update.mutate({ id: applied.id, body: { is_default: !applied.is_default } });
    }
  };

  return (
    <>
      <Dropdown menu={{ items: menu, onClick }} trigger={["click"]}>
        <Button
          icon={<DownOutlined />}
          iconPosition="end"
          loading={update.isPending}
          data-testid="saved-views"
        >
          {applied ? applied.name : items.length ? `Views · ${items.length}` : "Save this view"}
        </Button>
      </Dropdown>

      <SavedSearchForm
        open={saving}
        value={snapshot}
        onClose={() => setSaving(false)}
        onSaved={(saved) => {
          // Applied straight away, so the address names the view that was just
          // saved rather than the anonymous question it was saved from.
          if (fitsAList(saved)) view.applyView(saved);
        }}
      />
    </>
  );
}

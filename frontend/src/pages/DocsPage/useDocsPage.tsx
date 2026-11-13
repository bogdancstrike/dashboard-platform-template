import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Grid } from "antd";
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { docsApi, type DocPage } from "@/api/docs";
import { usePageCommands } from "@/commands/CommandContext";
import { type MoveRequest } from "@/components/docs/PageTree";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { queryKeys } from "@/lib/queryKeys";
import { apiMessageToast } from "@/lib/errors";

/**
 * The wiki's state: the open page and space, the tree, recent pages and search results, moving a page, and the palette commands.
 */
export function useDocsPage() {
  const { pageId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const screens = Grid.useBreakpoint();
  const phone = !screens.md;
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [spacing, setSpacing] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const query = params.get("q") ?? "";
  const term = useDebouncedValue(query.trim(), 250);

  const spaces = useQuery({ queryKey: queryKeys.docSpaces(), queryFn: ({ signal }) => docsApi.spaces(signal) });
  const current = useQuery({
    queryKey: queryKeys.docPage(pageId),
    queryFn: ({ signal }) => docsApi.page(pageId!, signal),
    enabled: Boolean(pageId),
  });
  const spaceId = current.data?.space.id ?? params.get("space") ?? spaces.data?.items.find((s) => s.kind === "GENERAL")?.id ?? spaces.data?.items[0]?.id;
  const tree = useQuery({
    queryKey: queryKeys.docTree(spaceId),
    queryFn: ({ signal }) => docsApi.tree(spaceId!, signal),
    enabled: Boolean(spaceId),
  });
  const recent = useQuery({
    queryKey: queryKeys.docRecent(),
    queryFn: ({ signal }) => docsApi.recent(signal),
    enabled: !pageId,
  });
  const results = useQuery({
    queryKey: queryKeys.docSearch(term),
    queryFn: ({ signal }) => docsApi.search(term, signal),
    enabled: term.length >= 2,
  });

  useEffect(() => setTreeOpen(false), [pageId]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const move = useMutation({
    mutationFn: (request: MoveRequest) => {
      const { id, ...rest } = request;
      return docsApi.move(id, rest);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.docTree(spaceId) }),
    onError: apiMessageToast(message, "The page was not moved."),
  });

  const canEdit = spaces.data?.can_edit ?? false;
  usePageCommands(
    "docs",
    canEdit ? [{ id: "docs.new", label: "Write a new wiki page", keywords: "docs wiki page new write", run: () => setCreating(true) }] : [],
  );

  const opened = (page: DocPage) => {
    setCreating(false);
    void queryClient.invalidateQueries({ queryKey: queryKeys.docTree(page.space.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.docSpaces() });
    navigate(`/docs/${page.id}?edit=1`);
  };

  const spaceList = spaces.data?.items ?? [];
  const space = spaceList.find((item) => item.id === spaceId);

  return { pageId, navigate, queryClient, message, screens, phone, params, setParams, creating, setCreating, spacing, setSpacing, treeOpen, setTreeOpen, query, term, spaces, current, spaceId, tree, recent, results, setParam, move, canEdit, opened, spaceList, space };
}

export type DocsPageModel = ReturnType<typeof useDocsPage>;

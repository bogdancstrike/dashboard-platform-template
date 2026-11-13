import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError } from "@/api/client";
import { filesApi, putBytes, type StoredFile } from "@/api/files";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { queryKeys } from "@/lib/queryKeys";
import { Transfer, UNFILED } from "./transfers";
import { useFileWrites } from "./useFileWrites";
import { useFolderTree } from "./useFolderTree";

/**
 * The file store's state: the open folder and previewed file in the address, the tree and the folder's files, uploads in flight, the tick-box selection, and every write — upload, download, rename, move, delete, folders.
 */
export function useFilesPage() {
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
  // On a phone the table scrolls sideways inside its container, which a
  // keyboard could not reach (axe scrollable-region-focusable, audit A). AntD
  // gives no prop for it, so the container is made focusable once drawn.
  const tableBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = tableBox.current?.querySelector<HTMLElement>(".ant-table-container");
    if (scroller && !scroller.hasAttribute("tabindex")) {
      scroller.tabIndex = 0;
      scroller.setAttribute("aria-label", "Files");
    }
  });
  // Which folder is open lives in the address (§69, §72), so "look in
  // /contracts" is a link rather than a set of instructions. Empty until the
  // tree answers, and then the first folder — a file manager that opens on
  // "Unfiled" opens on an empty list, because almost everything is filed.
  const [params, setParams] = useSearchParams();
  const folderId = params.get("folder") ?? "";
  const setFolderId = (next: string) =>
    setParams(
      (current) => {
        const replacement = new URLSearchParams(current);
        replacement.set("folder", next);
        return replacement;
      },
      // A folder is a place: back returns to the one before.
      { replace: false },
    );
  /**
   * Which file the pane is showing — in the *address*, not in state (§69).
   *
   * So "look at this one" is a link, the back button closes the pane, and a
   * reload lands where the reader was. It is also what "copy link" copies.
   */
  const previewing = params.get("file") ?? "";
  const setPreviewing = (next: string) =>
    setParams(
      (current) => {
        const replacement = new URLSearchParams(current);
        if (next) replacement.set("file", next);
        else replacement.delete("file");
        return replacement;
      },
      // Opening the preview is a place back closes; closing it replaces, so
      // the entry it opened is not left behind twice.
      { replace: !next },
    );
  const [search, setSearch] = useState("");
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [renaming, setRenaming] = useState<StoredFile | null>(null);
  /** The one-question modal for a new folder (§33). */
  const [namingFolder, setNamingFolder] = useState(false);
  /**
   * The files ticked, and where a bulk move is going.
   *
   * Held rather than put in the address, unlike the open folder and the
   * previewed file: a selection is a gesture in progress, and a link that
   * arrived with twelve files pre-ticked would be a link that invites somebody
   * to press Delete on a selection they did not make.
   */
  const [ticked, setTicked] = useState<string[]>([]);
  const [movingTo, setMovingTo] = useState(false);
  const term = useDebouncedValue(search, 280);

  const tree = useQuery({
    queryKey: queryKeys.filesTree(),
    queryFn: ({ signal }) => filesApi.tree(signal),
  });

  const open = folderId || tree.data?.folders[0]?.id || UNFILED;
  /** The folder a new one would go inside, or nothing at the top level. */
  const parentName =
    open === UNFILED ? "" : (tree.data?.folders.find((item) => item.id === open)?.name ?? "");

  const files = useQuery({
    queryKey: queryKeys.files(open, term),
    queryFn: ({ signal }) => filesApi.list({ folder_id: open, q: term || undefined }, signal),
    enabled: Boolean(tree.data),
    placeholderData: (previous) => previous,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.files() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.filesTree() });
  };

  const failed = (error: unknown) =>
    message.error(error instanceof ApiError ? error.message : String(error));

  /**
   * One file, all the way: ask, upload, confirm.
   *
   * Sequential per file but concurrent across them, which is what a browser is
   * good at — and each stage reports into the tray so a failure names the file
   * it happened to rather than the drop.
   */
  const send = async (file: File) => {
    const id = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setTransfers((current) => [
      ...current,
      { id, name: file.name, size: file.size, progress: 0, state: "uploading" },
    ]);
    const mark = (change: Partial<Transfer>) =>
      setTransfers((current) =>
        current.map((item) => (item.id === id ? { ...item, ...change } : item)),
      );

    try {
      const ticket = await filesApi.beginUpload({
        name: file.name,
        size_bytes: file.size,
        mime_type: file.type,
        folder_id: open === UNFILED ? null : open,
      });
      await putBytes(ticket, file, (fraction) => mark({ progress: Math.round(fraction * 100) }));
      // Confirmed, not assumed: the API checks the object is there before the
      // file becomes visible to anybody else.
      await filesApi.confirmUpload(ticket.file.id);
      mark({ progress: 100, state: "done" });
      refresh();
    } catch (error) {
      mark({
        state: "failed",
        error: error instanceof ApiError ? error.message : String(error),
      });
    }
  };

  const { download, rename, move, remove, bulk, addFolder, dropFolder } = useFileWrites({ open, refresh, failed, setTicked, setRenaming, setMovingTo, setFolderId });

  const canManage = tree.data?.can_manage ?? false;

  const { nodes, parentKeys, expanded, setExpanded, stored, openFolder, folderName, undeletable } = useFolderTree(
    tree.data,
    open,
    canManage,
    bulk,
  );

  usePageCommands("files", [
    {
      id: "files.folder",
      label: "Create a folder",
      keywords: "new directory",
      run: () => setNamingFolder(true),
    },
    {
      id: "files.unfiled",
      label: "Show the unfiled files",
      keywords: "loose root",
      run: () => setFolderId(UNFILED),
    },
    {
      id: "files.upload",
      label: "Upload into this folder",
      keywords: "upload add attach drop file new",
      // The dropzone's own input, so the palette opens the same picker the
      // visible control does rather than a second one that could drift.
      run: () =>
        document
          .querySelector<HTMLInputElement>('[data-testid="dropzone"] input[type="file"]')
          ?.click(),
    },
    ...(ticked.length > 0
      ? [
          {
            id: "files.move",
            label: `Move the ${ticked.length} selected to a folder`,
            keywords: "move folder file organise reorganise put",
            run: () => setMovingTo(true),
          },
          {
            id: "files.clear",
            label: "Clear the selection",
            keywords: "clear deselect untick none selection",
            run: () => setTicked([]),
          },
        ]
      : []),
    {
      id: "files.first",
      label: "Back to the first folder",
      keywords: "root top folders start clear",
      run: () => setFolderId(tree.data?.folders[0]?.id ?? UNFILED),
    },
  ]);

  return { queryClient, message, modal, tableBox, params, setParams, folderId, setFolderId, previewing, setPreviewing, search, setSearch, transfers, setTransfers, renaming, setRenaming, namingFolder, setNamingFolder, ticked, setTicked, movingTo, setMovingTo, term, tree, open, parentName, files, refresh, failed, send, download, rename, move, remove, bulk, addFolder, dropFolder, canManage, nodes, parentKeys, expanded, setExpanded, stored, openFolder, folderName, undeletable };
}

export type FilesPageModel = ReturnType<typeof useFilesPage>;

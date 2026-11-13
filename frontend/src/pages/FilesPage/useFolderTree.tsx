import { Typography } from "antd";
import { useMemo, useState } from "react";

import { filesApi, type FileFolder, type FileTree } from "@/api/files";

import { UNFILED } from "./transfers";

const { Text } = Typography;

/**
 * The folder tree as the rail draws it — each label a drop target for ticked
 * files — and what the store holds, the open folder, and why it cannot be
 * deleted when it cannot.
 */
export function useFolderTree(
  data: FileTree | undefined,
  open: string,
  canManage: boolean,
  bulk: { mutate: (input: { ids: string[]; act: (id: string) => Promise<unknown> }) => void },
) {
  const tree = { data };
  /** The flat list, nested by its materialised paths. */
  const nodes = useMemo(() => {
    const folders = tree.data?.folders ?? [];
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const children = new Map<string, FileFolder[]>();
    for (const folder of folders) {
      const key = folder.parent_id && byId.has(folder.parent_id) ? folder.parent_id : "";
      children.set(key, [...(children.get(key) ?? []), folder]);
    }

    /**
     * A folder's label, which is also where files are dropped.
     *
     * On the title rather than on the tree: AntD's own `draggable` moves
     * *nodes*, and what a file manager needs is the opposite — the folders
     * stay put and the files land on them. Wrapping the label keeps the tree's
     * own selection and expansion behaviour untouched.
     */
    const label = (id: string, name: string, count: number) => (
      <span
        className="nu-folder-node"
        onDragOver={
          canManage
            ? (event) => {
                event.preventDefault();
                event.currentTarget.classList.add("is-over");
              }
            : undefined
        }
        onDragLeave={
          canManage ? (event) => event.currentTarget.classList.remove("is-over") : undefined
        }
        onDrop={
          canManage
            ? (event) => {
                event.preventDefault();
                event.currentTarget.classList.remove("is-over");
                const ids = event.dataTransfer.getData("text/plain").split(",").filter(Boolean);
                // Dropping on the folder the files are already in is not a
                // change, and writing anyway would flash a toast for nothing.
                if (ids.length === 0 || id === open) return;
                bulk.mutate({
                  ids,
                  act: (file) =>
                    filesApi.update(file, { folder_id: id === UNFILED ? null : id }),
                });
              }
            : undefined
        }
        data-testid={`folder-${id}`}
      >
        <span>{name}</span>
        <Text type="secondary">{count}</Text>
      </span>
    );

    const build = (parent: string): { key: string; title: React.ReactNode; children?: unknown[] }[] =>
      (children.get(parent) ?? []).map((folder) => ({
        key: folder.id,
        title: label(folder.id, folder.name, folder.file_count),
        children: build(folder.id),
      }));

    return [
      {
        key: UNFILED,
        title: label(UNFILED, "Unfiled", tree.data?.unfiled.file_count ?? 0),
      },
      ...build(""),
    ];
    // `bulk` and `open` are read by the drop handler, and `canManage` decides
    // whether there is one — so the tree is rebuilt when any of them changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree.data, canManage, open, bulk]);

  /** Every folder that has children — what "expand all" opens. */
  const parentKeys = useMemo(() => {
    const out: string[] = [];
    const walk = (list: Array<{ key?: unknown; children?: unknown[] }>) => {
      for (const node of list) {
        if (node.children && node.children.length > 0) {
          out.push(String(node.key));
          walk(node.children as Array<{ key?: unknown; children?: unknown[] }>);
        }
      }
    };
    walk(nodes);
    return out;
  }, [nodes]);
  /** `null` until the reader folds something: everything open, as before. */
  const [expanded, setExpanded] = useState<string[] | null>(null);

  /** What the whole store holds — summed here rather than asked for twice. */
  const stored = useMemo(() => {
    const folders = tree.data?.folders ?? [];
    const unfiled = tree.data?.unfiled ?? { file_count: 0, total_bytes: 0 };
    return {
      files: folders.reduce((sum, folder) => sum + folder.file_count, unfiled.file_count),
      bytes: folders.reduce((sum, folder) => sum + folder.total_bytes, unfiled.total_bytes),
    };
  }, [tree.data]);

  const openFolder = tree.data?.folders.find((folder) => folder.id === open);
  const folderName = open === UNFILED ? "Unfiled" : (openFolder?.path ?? "");

  /**
   * Why this folder cannot be deleted, when it cannot.
   *
   * The service refuses a folder that is not empty, deliberately: a recursive
   * delete of a tree of files is a mistake somebody makes once and cannot
   * undo. So the reason is said here rather than discovered as a 409 after the
   * confirmation has been agreed to (§76). Unfiled is not a folder at all.
   */
  const undeletable = useMemo(() => {
    if (open === UNFILED) return "Unfiled is where loose files live — it is not a folder";
    if (!openFolder) return "No folder is open";
    const children = (tree.data?.folders ?? []).filter(
      (folder) => folder.parent_id === openFolder.id,
    ).length;
    if (openFolder.file_count > 0 || children > 0) {
      return "Only an empty folder can go — move or delete what is in it first";
    }
    return null;
  }, [open, openFolder, tree.data]);

  return { nodes, parentKeys, expanded, setExpanded, stored, openFolder, folderName, undeletable };
}

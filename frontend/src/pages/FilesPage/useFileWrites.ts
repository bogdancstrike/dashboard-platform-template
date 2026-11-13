import { useMutation } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { ApiError } from "@/api/client";
import { filesApi, type StoredFile } from "@/api/files";
import { UNFILED } from "./transfers";

/** Every write to the store: download, rename, move, delete — one or many — and folders. */
export function useFileWrites({
  open,
  refresh,
  failed,
  setTicked,
  setRenaming,
  setMovingTo,
  setFolderId,
}: {
  open: string;
  refresh: () => void;
  failed: (error: unknown) => unknown;
  setTicked: (ids: string[]) => void;
  setRenaming: (file: StoredFile | null) => void;
  setMovingTo: (on: boolean) => void;
  setFolderId: (id: string) => unknown;
}) {
  const { message } = AntApp.useApp();
  const download = useMutation({
    mutationFn: (file: StoredFile) => filesApi.downloadUrl(file.id),
    onSuccess: (answer) => {
      // The browser fetches the bytes itself, from storage — which is the
      // whole point of the signed URL.
      //
      // An anchor rather than `window.open`: the URL carries
      // `Content-Disposition: attachment`, so the browser downloads and stays
      // on this page, and a popup for a download is the sort of thing popup
      // blockers exist to stop.
      const link = document.createElement("a");
      link.href = answer.download.url;
      link.rel = "noopener";
      document.body.append(link);
      link.click();
      link.remove();
      refresh();
    },
    onError: failed,
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => filesApi.update(id, { name }),
    onSuccess: () => {
      setRenaming(null);
      refresh();
    },
    onError: failed,
  });

  const move = useMutation({
    mutationFn: ({ id, folder }: { id: string; folder: string | null }) =>
      filesApi.update(id, { folder_id: folder }),
    onSuccess: refresh,
    onError: failed,
  });

  const remove = useMutation({
    mutationFn: (file: StoredFile) => filesApi.remove(file.id),
    onSuccess: (gone) => {
      message.success(`${gone.name} deleted`);
      refresh();
    },
    onError: failed,
  });

  /**
   * Several files at once (§43, §75).
   *
   * One request per file rather than a bulk endpoint, because there is not one
   * for files and inventing a second write path for a dozen rows would be a
   * second set of permission checks to keep in step. Sequential rather than
   * parallel: a folder move of forty files through `Promise.all` is forty
   * simultaneous writes to the same parent, and the failure mode is a partial
   * move nobody can read.
   *
   * What it reports is what happened — "9 moved, 3 refused" — rather than a
   * success toast over a partial result. A bulk action that hides its failures
   * is one somebody trusts exactly once.
   */
  const bulk = useMutation({
    mutationFn: async (input: { ids: string[]; act: (id: string) => Promise<unknown> }) => {
      let done = 0;
      const refused: string[] = [];
      for (const id of input.ids) {
        try {
          await input.act(id);
          done += 1;
        } catch (error) {
          refused.push(error instanceof ApiError ? error.message : String(error));
        }
      }
      return { done, refused };
    },
    onSuccess: ({ done, refused }) => {
      setTicked([]);
      setMovingTo(false);
      if (refused.length === 0) {
        message.success(`${done} ${done === 1 ? "file" : "files"} done`);
      } else {
        // The first reason, not a count of them: twelve identical refusals are
        // one fact, and the reason is what somebody needs.
        message.warning(`${done} done, ${refused.length} refused — ${refused[0]}`);
      }
      refresh();
    },
    onError: failed,
  });

  const addFolder = useMutation({
    mutationFn: (name: string) =>
      filesApi.createFolder({ name, parent_id: open === UNFILED ? null : open }),
    onSuccess: (folder) => {
      setFolderId(folder.id);
      refresh();
    },
    onError: failed,
  });

  const dropFolder = useMutation({
    mutationFn: (id: string) => filesApi.removeFolder(id),
    onSuccess: () => {
      setFolderId(UNFILED);
      refresh();
    },
    onError: failed,
  });

  return { download, rename, move, remove, bulk, addFolder, dropFolder };
}

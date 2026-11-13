import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { filesApi, putBytes, readableSize } from "@/api/files";
import { knowledgeApi, type CollectionDetail } from "@/api/knowledge";
import { queryKeys } from "@/lib/queryKeys";

/** The converter's own ceiling; the server refuses above it too. */
export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

export type TrayState = "uploading" | "adding" | "done" | "error" | "refused" | "cancelled";

export interface TrayItem {
  key: string;
  file: File;
  state: TrayState;
  fraction: number;
  message?: string;
  controller?: AbortController;
}

/** Why a file cannot be read for questions, before a byte is sent — or nothing. */
export function refusal(file: File, supported: string[], maxBytes: number): string | null {
  const extension = extensionOf(file.name);
  if (!extension || !supported.includes(extension)) {
    return `${extension ? `.${extension}` : "This kind of"} file cannot be read for questions. Use PDF, Word, PowerPoint, Excel, HTML, Markdown or text.`;
  }
  if (file.size > maxBytes) {
    return `${readableSize(file.size)} is over the ${readableSize(maxBytes)} a document may be. Split it and upload the parts.`;
  }
  if (file.size === 0) return "The file is empty.";
  return null;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Refresh the collection and the collection list after its documents change. */
export function useRefreshCollection(collectionId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeCollection(collectionId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeCollections() });
  };
}

/**
 * The upload tray: files dropped on a collection, each uploaded, confirmed and
 * added in turn — cancellable while uploading, retryable after a failure, and
 * refused up front when it could never be read.
 */
export function useUploadTray(collection: CollectionDetail, supported: string[], maxBytes: number) {
  const refresh = useRefreshCollection(collection.id);
  const [tray, setTray] = useState<TrayItem[]>([]);
  const counter = useRef(0);
  const patch = (key: string, next: Partial<TrayItem>) =>
    setTray((items) => items.map((item) => (item.key === key ? { ...item, ...next } : item)));
  const dismiss = (key: string) => setTray((items) => items.filter((entry) => entry.key !== key));

  async function send(item: TrayItem) {
    const controller = new AbortController();
    patch(item.key, { state: "uploading", fraction: 0, message: undefined, controller });
    try {
      const ticket = await filesApi.beginUpload({
        name: item.file.name,
        size_bytes: item.file.size,
        mime_type: item.file.type || undefined,
        folder_id: collection.folder_id,
      });
      await putBytes(
        ticket,
        item.file,
        (fraction) => patch(item.key, { fraction }),
        controller.signal,
      );
      await filesApi.confirmUpload(ticket.file.id);
      patch(item.key, { state: "adding", fraction: 1 });
      await knowledgeApi.addDocuments(collection.id, [ticket.file.id]);
      patch(item.key, { state: "done", controller: undefined });
      refresh();
      // A finished upload leaves the tray: its reading is on the list below.
      window.setTimeout(
        () => setTray((items) => items.filter((entry) => entry.key !== item.key)),
        1200,
      );
    } catch (error) {
      const cancelled = controller.signal.aborted;
      patch(item.key, {
        state: cancelled ? "cancelled" : "error",
        message: cancelled ? "Cancelled" : (error as Error).message,
        controller: undefined,
      });
    }
  }

  function accept(files: File[]) {
    const items: TrayItem[] = files.map((file) => {
      counter.current += 1;
      const reason = refusal(file, supported, maxBytes);
      return {
        key: `u${counter.current}`,
        file,
        state: reason ? "refused" : "uploading",
        fraction: 0,
        message: reason ?? undefined,
      };
    });
    setTray((current) => [...current.filter((item) => item.state !== "done"), ...items]);
    for (const item of items) if (item.state !== "refused") void send(item);
  }
  return { tray, accept, send, dismiss };
}

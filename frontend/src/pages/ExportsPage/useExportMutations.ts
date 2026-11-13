import { useMutation } from "@tanstack/react-query";
import { App as AntApp } from "antd";

import { exportsApi } from "@/api/exports";
import { errorText } from "@/lib/errors";

interface ExportContext {
  request: { resource_type: string; format: string };
  opened: string;
  refresh: () => Promise<void>;
  onQueued: () => void;
  openExport: (id: string) => void;
  closeExport: () => void;
}

/** Queue the composed export, ask for one again, discard one, or fetch its file. */
export function useExportMutations({ request, opened, refresh, onQueued, openExport, closeExport }: ExportContext) {
  const { message } = AntApp.useApp();
  const queued = useMutation({
    mutationFn: () => exportsApi.queue(request),
    onSuccess: async (made) => {
      onQueued();
      await refresh();
      message.success(`${made.reference} queued`);
      // Opened straight away, because the thing somebody wants next is the
      // file — and this is where it will appear.
      openExport(made.id);
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "export" }));
    },
  });

  const asked = useMutation({
    mutationFn: (id: string) => exportsApi.again(id),
    onSuccess: async (made) => {
      await refresh();
      message.success(`Asked again as ${made.reference}`);
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "export" }));
    },
  });

  const discarded = useMutation({
    mutationFn: (id: string) => exportsApi.forget(id),
    onSuccess: async (answer) => {
      await refresh();
      // Two presses, two outcomes, and the message has to say which happened
      // or the second press looks like the first one not having worked.
      message.success(
        answer.removed
          ? `${answer.reference} has been removed from your list`
          : "The file has been discarded; the record is kept",
      );
      if (answer.removed && answer.id === opened) {
        closeExport();
      }
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "export" }));
    },
  });

  const fetched = useMutation({
    mutationFn: (id: string) => exportsApi.download(id),
    onSuccess: (link) => {
      // A signed URL, opened rather than proxied: the bytes come from object
      // storage, so a finished export never costs the API worker twice.
      window.open(link.url, "_blank", "noopener,noreferrer");
    },
    onError: async (error: unknown) => {
      message.error(errorText(error, { action: "export" }));
      // The refusal is also news: an expired or missing file makes the row's
      // own answer stale, and the server has just corrected it.
      await refresh();
    },
  });

  return { queued, asked, discarded, fetched };
}

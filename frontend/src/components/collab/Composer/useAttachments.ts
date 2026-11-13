import { App as AntApp } from "antd";
import { useState } from "react";

import { filesApi, putBytes } from "@/api/files";

import { Pending } from "./mentions";

/** Files attached to the message being written: each uploaded straight away, with its progress or its error. */
export function useAttachments() {
  const { message } = AntApp.useApp();
  const [pending, setPending] = useState<Pending[]>([]);
  const uploading = pending.some((item) => !item.file && !item.error);
  const ready = pending.filter((item) => item.file).map((item) => item.file!.id);

  const upload = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      const key = `${file.name}-${file.size}-${Date.now()}`;
      setPending((current) => [...current, { key, name: file.name, size: file.size, progress: 0 }]);
      try {
        const ticket = await filesApi.beginUpload({
          name: file.name,
          size_bytes: file.size,
          mime_type: file.type || undefined,
        });
        await putBytes(ticket, file, (fraction) =>
          setPending((current) =>
            current.map((item) => (item.key === key ? { ...item, progress: Math.round(fraction * 100) } : item)),
          ),
        );
        const stored = await filesApi.confirmUpload(ticket.file.id);
        setPending((current) =>
          current.map((item) =>
            item.key === key
              ? {
                  ...item,
                  progress: 100,
                  file: { id: stored.id, name: stored.name, size_bytes: file.size, mime_type: file.type || null },
                }
              : item,
          ),
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : "The file was not uploaded.";
        message.error(reason);
        setPending((current) => current.map((item) => (item.key === key ? { ...item, error: reason } : item)));
      }
    }
  };

  return { pending, setPending, upload, uploading, ready };
}

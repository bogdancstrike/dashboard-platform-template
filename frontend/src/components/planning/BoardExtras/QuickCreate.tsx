import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Input } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useState } from "react";

import { recordsApi } from "@/api/records";
import { refreshRecordViews } from "@/lib/refresh";

import { apiMessageToast } from "@/lib/errors";

/** The "+ Add a card" at the foot of a lane, which becomes an input. */
export function QuickCreate({ status, extra, onCreated }: { status: string; extra?: Record<string, unknown>; onCreated?: (id: string) => void }) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const create = useMutation({
    mutationFn: (text: string) => recordsApi.create("task", { title: text, status, ...extra }),
    onSuccess: (made) => {
      setTitle("");
      message.success(`${made.subtitle || "Task"} added`);
      refreshRecordViews(queryClient);
      onCreated?.(made.id);
    },
    onError: apiMessageToast(message, "That card could not be added."),
  });
  if (!open) {
    return (
      <button type="button" className="nx-rec-lane-new" onClick={() => setOpen(true)} data-testid={`quick-add-${status}`}>
        <PlusOutlined /> Add a card
      </button>
    );
  }
  return (
    <div className="nx-pl-quick">
      <Input
        autoFocus
        aria-label={`New card in ${status.replace(/_/g, " ").toLowerCase()}`}
        placeholder="What needs doing?"
        value={title}
        disabled={create.isPending}
        onChange={(event) => setTitle(event.target.value)}
        onPressEnter={() => title.trim() && create.mutate(title.trim())}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            setTitle("");
          }
        }}
        onBlur={() => !title.trim() && setOpen(false)}
        data-testid={`quick-input-${status}`}
      />
    </div>
  );
}

import { useMutation } from "@tanstack/react-query";
import { App as AntApp } from "antd";

import { importsApi } from "@/api/imports";
import { errorText } from "@/lib/errors";
import { formatNumber } from "@/lib/formats";

interface RunContext {
  /** The dataset a new file goes into. */
  target: string;
  /** The open run. */
  opened: string;
  mapping: Record<string, string>;
  refresh: () => Promise<void>;
  open: (id: string) => void;
  close: () => void;
}

/** Begin a run from a file, check its mapping, execute it, or discard it. */
export function useRunMutations({ target, opened, mapping, refresh, open, close }: RunContext) {
  const { message } = AntApp.useApp();
  const begun = useMutation({
    mutationFn: (input: { filename: string; content: string }) =>
      importsApi.begin({
        target_entity: target,
        filename: input.filename,
        content: input.content,
      }),
    onSuccess: async (made) => {
      await refresh();
      open(made.id);
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "import" }));
    },
  });

  const mapped = useMutation({
    mutationFn: () => importsApi.map(opened, mapping),
    onSuccess: async (answer) => {
      await refresh();
      message.success(
        answer.valid_rows
          ? answer.valid_rows === 1
            ? "1 row is ready"
            : `${formatNumber(answer.valid_rows)} rows are ready`
          : "Nothing in this file can be imported yet",
      );
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "import" }));
    },
  });

  const executed = useMutation({
    mutationFn: () => importsApi.execute(opened),
    onSuccess: async () => {
      await refresh();
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "import" }));
    },
  });

  const discarded = useMutation({
    mutationFn: (id: string) => importsApi.discard(id),
    onSuccess: async (answer) => {
      close();
      await refresh();
      // Which of the two happened, or the second press looks like the first
      // one not having worked.
      message.success(
        answer.removed
          ? `${answer.reference} has been removed from your list`
          : "Discarded. The record of the attempt is kept.",
      );
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "import" }));
    },
  });

  return { begun, mapped, executed, discarded };
}

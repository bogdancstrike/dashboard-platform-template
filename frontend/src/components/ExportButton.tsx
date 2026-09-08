import { App as AntApp, Button, Dropdown } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { errorText } from "@/lib/errors";

/**
 * "Export" on any list (§30).
 *
 * One control, three formats, and one behaviour worth stating: it exports the
 * **question**, not the page. The caller hands it a function that asks the
 * server for the current filters — so a reader who narrowed 200 000 rows to
 * 340 gets 340, not the 25 in front of them.
 *
 * A download is one of the few actions with no visible result inside the app:
 * the file lands in a folder somewhere and the page does not change. So the
 * button says what happened, both ways — otherwise a refused export is
 * indistinguishable from a slow one.
 *
 * **And a refusal for size is not a dead end.** Above `core/export.MAX_ROWS`
 * the server refuses rather than truncating, and says so with
 * `queue_instead: true` — for a long time that message named a path the
 * product did not offer, which is the worst kind of error message. Give this
 * button an `onQueue` and the refusal becomes the offer: the row count that
 * was too large, and one press to produce the whole set in the background
 * (§30). It lives here rather than on each page because every list in the
 * platform exports through this one control.
 */
export type ExportFormat = "csv" | "json" | "xlsx";

const FORMATS: { key: ExportFormat; label: string }[] = [
  { key: "csv", label: "CSV — for a spreadsheet" },
  { key: "xlsx", label: "Excel workbook" },
  { key: "json", label: "JSON — for another system" },
];

export function ExportButton({
  onExport,
  onQueue,
  disabled,
  label = "Export",
  size,
}: {
  /** Runs the download. Rejects with an `ApiError` the button will report. */
  onExport: (format: ExportFormat) => Promise<void>;
  /**
   * Queues the same question as a background export (§30). Offered only when
   * the server refuses a download for being too large, and left to the caller
   * so the page can say where the export went afterwards.
   */
  onQueue?: (format: ExportFormat) => Promise<void>;
  disabled?: boolean;
  label?: string;
  size?: "small" | "middle" | "large";
}) {
  const { message, modal } = AntApp.useApp();
  const [busy, setBusy] = useState(false);

  /** Whether this refusal is the one the queued path exists for. */
  const tooLarge = (error: unknown): error is ApiError =>
    error instanceof ApiError && error.details["queue_instead"] === true;

  const offerToQueue = (error: ApiError, format: ExportFormat) => {
    const total = Number(error.details["total"] ?? 0);
    const maximum = Number(error.details["maximum"] ?? 0);
    modal.confirm({
      title: "Too many rows to download",
      // The numbers, because "too large" without them leaves somebody
      // guessing how much they have to narrow it by.
      content: `That is ${total.toLocaleString()} rows and a download stops at ${maximum.toLocaleString()}. The whole set can be produced in the background instead.`,
      okText: "Queue it as an export",
      cancelText: "Leave it",
      onOk: async () => {
        try {
          await onQueue?.(format);
        } catch (failure) {
          message.error(errorText(failure, { fallback: "The export could not be produced.", action: "export" }));
          // Rethrown so the dialog stays open on a failure the person can act
          // on — a pending limit, most likely.
          throw failure;
        }
      },
    });
  };

  const run = async (format: ExportFormat) => {
    setBusy(true);
    try {
      await onExport(format);
      message.success(`Your ${format.toUpperCase()} download has started.`);
    } catch (error) {
      if (onQueue && tooLarge(error)) offerToQueue(error, format);
      else message.error(errorText(error, { fallback: "The export could not be produced.", action: "export" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dropdown
      disabled={disabled || busy}
      menu={{
        items: FORMATS.map((format) => ({ key: format.key, label: format.label })),
        onClick: ({ key }) => void run(key as ExportFormat),
      }}
    >
      <Button icon={<DownloadOutlined />} loading={busy} size={size} disabled={disabled}>
        {label}
      </Button>
    </Dropdown>
  );
}

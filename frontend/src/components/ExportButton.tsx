import { App as AntApp, Button, Dropdown } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { useState } from "react";

import { ApiError } from "@/api/client";

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
 */
export type ExportFormat = "csv" | "json" | "xlsx";

const FORMATS: { key: ExportFormat; label: string }[] = [
  { key: "csv", label: "CSV — for a spreadsheet" },
  { key: "xlsx", label: "Excel workbook" },
  { key: "json", label: "JSON — for another system" },
];

export function ExportButton({
  onExport,
  disabled,
  label = "Export",
  size,
}: {
  /** Runs the download. Rejects with an `ApiError` the button will report. */
  onExport: (format: ExportFormat) => Promise<void>;
  disabled?: boolean;
  label?: string;
  size?: "small" | "middle" | "large";
}) {
  const { message } = AntApp.useApp();
  const [busy, setBusy] = useState(false);

  const run = async (format: ExportFormat) => {
    setBusy(true);
    try {
      await onExport(format);
      message.success(`Your ${format.toUpperCase()} download has started.`);
    } catch (error) {
      const detail =
        error instanceof ApiError
          ? error.isForbidden
            ? `You do not have permission to export${
                error.missingPermissions.length
                  ? ` (missing ${error.missingPermissions.join(", ")})`
                  : ""
              }.`
            : `${error.message} · ${error.correlationId}`
          : "The export could not be produced.";
      message.error(detail);
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

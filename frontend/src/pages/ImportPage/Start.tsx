import { App as AntApp, Card, Select, Typography, Upload } from "antd";
import { InboxOutlined } from "@ant-design/icons";

import type { ImportCatalogue, ImportTarget } from "@/api/imports";
import { formatNumber } from "@/lib/formats";

import { fieldLabel } from "./importCopy";

const { Text } = Typography;

/** Step one: which dataset, and which file. */
export function Start({
  targets,
  catalogue,
  chosen,
  onChoose,
  onFile,
  busy,
}: {
  targets: ImportTarget[];
  catalogue: ImportCatalogue | undefined;
  chosen: ImportTarget | undefined;
  onChoose: (key: string) => void;
  onFile: (filename: string, content: string) => void;
  busy: boolean;
}) {
  const { message } = AntApp.useApp();
  const limit = catalogue?.max_bytes ?? 0;

  return (
    <Card className="nu-imp-start" size="small" data-testid="import-start">
      <div className="nu-imp-choose">
        <Text strong>Into</Text>
        <Select
          id="imp-target"
          aria-label="Dataset"
          className="nu-imp-target"
          value={chosen?.key}
          onChange={onChoose}
          options={targets.map((entry) => ({ value: entry.key, label: entry.label }))}
        />
        {chosen ? (
          <Text type="secondary" data-testid="target-required">
            {chosen.required.length
              ? `Every row needs ${chosen.required
                  .map((name) => fieldLabel(chosen, name))
                  .join(", ")}.`
              : "No field is required, so a row with anything in it can be imported."}
          </Text>
        ) : null}
      </div>

      <Upload.Dragger
        className="nu-imp-drop"
        data-testid="import-drop"
        accept=".csv,.tsv,.txt,text/csv"
        multiple={false}
        showUploadList={false}
        disabled={busy || !chosen}
        beforeUpload={(file) => {
          // Checked here *and* on the server: a check only in the browser is
          // not a check, and one only on the server wastes an upload.
          if (limit && file.size > limit) {
            message.error(
              `That file is ${(file.size / 1_048_576).toFixed(1)} MB and the limit is ${(
                limit / 1_048_576
              ).toFixed(0)} MB.`,
            );
            return Upload.LIST_IGNORE;
          }
          void file
            .text()
            .then((content) => onFile(file.name, content))
            .catch(() => message.error("That file could not be read."));
          // Never handed to AntD's uploader: the text goes in a JSON body, so
          // there is no multipart request to make.
          return Upload.LIST_IGNORE;
        }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">Drop a CSV here, or click to choose one</p>
        {/* The testid is on the hint rather than on the Dragger: AntD forwards
            a `data-*` to its outer wrapper, which carries no text — the same
            trap `Modal` sets. */}
        <p className="ant-upload-hint" data-testid="import-limits">
          {catalogue
            ? `Up to ${formatNumber(catalogue.max_rows)} rows. Comma, semicolon, tab or pipe — the separator is detected and shown.`
            : ""}
        </p>
      </Upload.Dragger>
    </Card>
  );
}

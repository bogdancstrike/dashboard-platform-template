import { Button, Progress, Typography } from "antd";
import { readableSize } from "@/api/files";

import type { FilesPageModel } from "./useFilesPage";

/** The uploads in flight and just finished, with their progress. */
export function TransferTray({ m }: { m: FilesPageModel }) {
  const { transfers, setTransfers } = m;
  const { Text } = Typography;
  const active = transfers.filter((item) => item.state === "uploading");
  return (
    <>
      {transfers.length > 0 && (
        <div className="nu-transfers" data-testid="upload-tray">
          <div className="nu-transfers-head">
            <Text strong>{active.length > 0 ? `Uploading ${active.length}` : "Uploads"}</Text>
            <Button type="text" onClick={() => setTransfers([])}>
              Clear
            </Button>
          </div>
          {/* Per file, not one bar for the drop: a failure names the file
              it happened to, and the rest carry on. */}
          {transfers.map((transfer) => (
            <div key={transfer.id} className="nu-transfer">
              <div className="nu-transfer-name">
                <Text ellipsis>{transfer.name}</Text>
                <Text type="secondary">{readableSize(transfer.size)}</Text>
              </div>
              <Progress
                percent={transfer.progress}
                size="small"
                status={
                  transfer.state === "failed"
                    ? "exception"
                    : transfer.state === "done"
                      ? "success"
                      : "active"
                }
                aria-label={`${transfer.name}: ${transfer.progress}%`}
              />
              {transfer.error && (
                <Text type="danger" style={{ fontSize: 12 }}>
                  {transfer.error}
                </Text>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

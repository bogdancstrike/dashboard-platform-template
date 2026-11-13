import { Button, Progress, Typography } from "antd";
import { CloseOutlined, ReloadOutlined } from "@ant-design/icons";

import { readableSize } from "@/api/files";

import { extensionOf, type TrayItem } from "./uploads";

const { Text } = Typography;

/** Each file on its way in: its progress, then what happened, with cancel, retry and dismiss. */
export function UploadTray({
  tray,
  onRetry,
  onDismiss,
}: {
  tray: TrayItem[];
  onRetry: (item: TrayItem) => void;
  onDismiss: (key: string) => void;
}) {
  return (
    <ul className="nx-kn-tray" data-testid="upload-tray" aria-live="polite">
      {tray.map((item) => (
        <li
          key={item.key}
          className={`nx-kn-tray-item is-${item.state}`}
          data-testid="upload-item"
          data-state={item.state}
        >
          <span className="nx-kn-doc-icon" aria-hidden>
            {extensionOf(item.file.name).toUpperCase().slice(0, 4) || "FILE"}
          </span>
          <div className="nx-kn-tray-main">
            <Text strong ellipsis>
              {item.file.name}
            </Text>
            {item.state === "uploading" || item.state === "adding" ? (
              <Progress
                aria-label={`Uploading ${item.file.name}`}
                percent={Math.round(item.fraction * 100)}
                size="small"
                status="active"
                format={() =>
                  item.state === "adding" ? "Adding…" : `${Math.round(item.fraction * 100)}%`
                }
              />
            ) : (
              <Text
                type={
                  item.state === "done"
                    ? "success"
                    : item.state === "cancelled"
                      ? "secondary"
                      : "danger"
                }
                className="nx-kn-doc-error"
                data-testid="upload-message"
              >
                {item.state === "done"
                  ? `Uploaded · ${readableSize(item.file.size)} — reading it now`
                  : item.message}
              </Text>
            )}
          </div>
          <div className="nx-kn-doc-actions">
            {item.state === "uploading" && (
              <Button onClick={() => item.controller?.abort()} data-testid="upload-cancel">
                Cancel
              </Button>
            )}
            {(item.state === "error" || item.state === "cancelled") && (
              <Button
                icon={<ReloadOutlined />}
                onClick={() => onRetry(item)}
                data-testid="upload-retry"
              >
                Retry
              </Button>
            )}
            {item.state !== "uploading" && item.state !== "adding" && (
              <Button
                type="text"
                shape="circle"
                icon={<CloseOutlined />}
                aria-label={`Dismiss ${item.file.name}`}
                onClick={() => onDismiss(item.key)}
              />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

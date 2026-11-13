import { Typography, Upload } from "antd";

import { readableSize } from "@/api/files";
import { NxIcon } from "@/components/NxIcon";

const { Text } = Typography;

/** Where files are dropped — larger, and saying what it is for, while the collection is empty. */
export function DropZone({
  supported,
  maxBytes,
  empty,
  onFiles,
}: {
  supported: string[];
  maxBytes: number;
  empty: boolean;
  onFiles: (files: File[]) => void;
}) {
  return (
    <Upload.Dragger
      multiple
      showUploadList={false}
      accept={supported.map((ext) => `.${ext}`).join(",")}
      beforeUpload={(file, list) => {
        // Called once per file with the whole list; act on the first call.
        if (file === list[0]) onFiles(list);
        return false;
      }}
      className={`nx-kn-drop${empty ? " is-empty" : ""}`}
      data-testid="documents-drop"
    >
      <div className="nx-kn-drop-inner">
        <span className="nx-kn-drop-icon">
          <NxIcon name="import" size={empty ? 26 : 20} />
        </span>
        <div>
          <Text strong className="nx-kn-drop-title">
            {empty ? "Drop the files people ask about" : "Drop more files, or click to choose"}
          </Text>
          <div>
            <Text type="secondary">
              PDF, Word, PowerPoint, Excel, HTML, Markdown and text, up to {readableSize(maxBytes)}{" "}
              each — read with their page numbers, so answers cite the page.
            </Text>
          </div>
        </div>
      </div>
    </Upload.Dragger>
  );
}

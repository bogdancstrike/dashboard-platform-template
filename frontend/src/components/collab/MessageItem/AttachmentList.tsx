import { App as AntApp } from "antd";
import { PaperClipOutlined } from "@ant-design/icons";

import type { Attachment } from "@/api/comments";
import { filesApi, readableSize } from "@/api/files";

export function AttachmentList({ files }: { files: Attachment[] }) {
  const { message } = AntApp.useApp();
  if (files.length === 0) return null;
  const open = async (file: Attachment) => {
    try {
      const signed = await filesApi.downloadUrl(file.id);
      window.open(signed.download.url, "_blank", "noopener");
    } catch {
      message.error(`${file.name} could not be opened.`);
    }
  };
  return (
    <ul className="nx-co-files" aria-label="Attached files">
      {files.map((file) => (
        <li key={file.id}>
          <button type="button" onClick={() => void open(file)} className="nx-co-file">
            <PaperClipOutlined />
            <span className="nx-co-file-name">{file.name}</span>
            <span className="nx-co-muted">{readableSize(file.size_bytes)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

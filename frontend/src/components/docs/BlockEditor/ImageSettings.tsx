import { App as AntApp, Button, Input, Space, Upload } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { useState } from "react";

import type { DocBlock } from "@/api/docs";
import { filesApi, putBytes } from "@/api/files";

export function ImageSettings({ block, onChange }: { block: DocBlock; onChange: (next: DocBlock) => void }) {
  const { message } = AntApp.useApp();
  const [busy, setBusy] = useState(false);
  return (
    <Space direction="vertical" className="nu-block">
      <Upload
        accept="image/*"
        showUploadList={false}
        customRequest={async ({ file }) => {
          const picked = file as File;
          setBusy(true);
          try {
            const ticket = await filesApi.beginUpload({ name: picked.name, size_bytes: picked.size, mime_type: picked.type });
            await putBytes(ticket, picked, () => undefined);
            const stored = await filesApi.confirmUpload(ticket.file.id);
            onChange({ ...block, file_id: stored.id });
          } catch (error) {
            message.error(error instanceof Error ? error.message : "The image was not uploaded.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Button icon={<UploadOutlined />} loading={busy}>
          {block.file_id ? "Replace image" : "Upload an image"}
        </Button>
      </Upload>
      <Input
        aria-label="Caption"
        placeholder="Caption"
        value={block.caption ?? ""}
        onChange={(event) => onChange({ ...block, caption: event.target.value })}
      />
    </Space>
  );
}

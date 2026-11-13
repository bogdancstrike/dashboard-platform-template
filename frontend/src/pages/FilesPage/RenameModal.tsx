import { Input, Modal, Select, Space, Typography } from "antd";
import { useState } from "react";

import { type FileFolder, type StoredFile } from "@/api/files";

import { UNFILED } from "./transfers";

const { Text } = Typography;

/**
 * Rename and move, in one dialog.
 *
 * Both, because they are the same thought — "this is in the wrong place and
 * called the wrong thing" — and because neither touches the object: a storage
 * key is an address, not a path.
 */
export function RenameModal({
  file,
  folders,
  saving,
  onClose,
  onSave,
}: {
  file: StoredFile | null;
  folders: FileFolder[];
  saving: boolean;
  onClose: () => void;
  onSave: (name: string, folderId: string) => void;
}) {
  const [name, setName] = useState("");
  const [folder, setFolder] = useState(UNFILED);

  return (
    <Modal
      open={file !== null}
      title={`Rename ${file?.name ?? ""}`}
      okText="Save"
      confirmLoading={saving}
      afterOpenChange={(open) => {
        if (open && file) {
          setName(file.name);
          setFolder(file.folder_id ?? UNFILED);
        }
      }}
      onCancel={onClose}
      onOk={() => onSave(name.trim() || (file?.name ?? ""), folder)}
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <div>
          <Text strong className="nu-field-label">
            Name
          </Text>
          <Input
            value={name}
            aria-label="File name"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div>
          <Text strong className="nu-field-label">
            Folder
          </Text>
          <Select
            style={{ width: "100%" }}
            aria-label="Folder"
            value={folder}
            onChange={setFolder}
            options={[
              { value: UNFILED, label: "Unfiled" },
              ...folders.map((item) => ({ value: item.id, label: item.path })),
            ]}
          />
        </div>
      </Space>
    </Modal>
  );
}

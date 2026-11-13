/**
 * The Edit and Delete buttons on a record's own page (§7, §76).
 *
 * Disabled rather than hidden when the role does not allow them, with the
 * permission named on hover: a reader who cannot edit learns why, instead of
 * wondering where the button went.
 */

import { Button, Tooltip } from "antd";
import { DeleteOutlined, EditOutlined } from "@ant-design/icons";

export function RecordEditButton({ allowed, onEdit }: { allowed: boolean; onEdit: () => void }) {
  return (
    <Tooltip title={allowed ? "" : "Your role does not include records.update"}>
      <Button
        type="primary"
        icon={<EditOutlined />}
        disabled={!allowed}
        onClick={onEdit}
        data-testid="record-edit"
      >
        Edit
      </Button>
    </Tooltip>
  );
}

export function RecordDeleteButton({ allowed, onDelete }: { allowed: boolean; onDelete: () => void }) {
  return (
    <Tooltip title={allowed ? "" : "Your role does not include records.delete"}>
      <Button danger icon={<DeleteOutlined />} disabled={!allowed} onClick={onDelete}>
        Delete
      </Button>
    </Tooltip>
  );
}

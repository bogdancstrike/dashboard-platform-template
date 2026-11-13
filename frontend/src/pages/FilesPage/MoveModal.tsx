import { Modal, Select, Typography } from "antd";

import { filesApi } from "@/api/files";

import { UNFILED } from "./transfers";

import type { FilesPageModel } from "./useFilesPage";

const { Paragraph } = Typography;

/** Move the ticked files to another folder. */
export function MoveModal({ m }: { m: FilesPageModel }) {
  const { ticked, movingTo, setMovingTo, tree, bulk } = m;
  return (
    <Modal
      open={movingTo}
      title={`Move ${ticked.length} ${ticked.length === 1 ? "file" : "files"}`}
      footer={null}
      onCancel={() => setMovingTo(false)}
      destroyOnHidden
    >
      <Paragraph type="secondary">
        Pick the folder they go to. Dragging them onto a folder in the rail does the same
        thing.
      </Paragraph>
      <Select
        autoFocus
        showSearch
        optionFilterProp="label"
        style={{ width: "100%" }}
        placeholder="Which folder"
        aria-label="Move to folder"
        options={[
          { value: UNFILED, label: "Unfiled" },
          ...(tree.data?.folders ?? []).map((folder) => ({
            value: folder.id,
            label: folder.path || folder.name,
          })),
        ]}
        onChange={(value: string) =>
          bulk.mutate({
            ids: ticked,
            act: (id) =>
              filesApi.update(id, { folder_id: value === UNFILED ? null : value }),
          })
        }
      />
    </Modal>
  );
}

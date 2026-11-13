import { App, Button, Popconfirm, Space, Tooltip } from "antd";

import { TdIcon } from "@/components/icons/TdIcon";
import { FEATURES, useFeature } from "@/settings/features";

import type { useFormDesigner } from "./useFormDesigner";

/** Copy the public link, remove, save, and publish or close — for a reader who manages forms. */
export function DesignerActions({ designer }: { designer: ReturnType<typeof useFormDesigner> }) {
  const publicFormsOn = useFeature(FEATURES.publicForms);
  const { message } = App.useApp();
  const { creating, dirty, save, remove } = designer;
  const draft = designer.draft!;
  return (
    <Space wrap>
      {!creating && draft.status === "PUBLISHED" && publicFormsOn && (
        <Tooltip title="Copy the public address">
          <Button icon={<TdIcon name="copy" />} onClick={() => void navigator.clipboard?.writeText(`${window.location.origin}${draft.public_path}`).then(() => message.success("Address copied"))}>
            Copy link
          </Button>
        </Tooltip>
      )}
      {!creating && (
        <Popconfirm title="Remove this form? Its submissions are kept with their records." onConfirm={() => remove.mutate()}>
          <Button danger>Remove</Button>
        </Popconfirm>
      )}
      <Button loading={save.isPending} disabled={!dirty && !creating} onClick={() => save.mutate(undefined)} data-testid="form-save">Save</Button>
      {draft.status === "PUBLISHED" ? (
        <Button onClick={() => save.mutate("CLOSED")}>Close form</Button>
      ) : (
        <Button type="primary" loading={save.isPending} onClick={() => save.mutate("PUBLISHED")} data-testid="form-publish">Publish</Button>
      )}
    </Space>
  );
}

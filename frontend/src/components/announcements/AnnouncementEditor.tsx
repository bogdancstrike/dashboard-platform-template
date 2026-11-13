/**
 * Writing a notice (§10, §17).
 *
 * A drawer rather than a wizard, and rather than a page. The decision has no
 * parts — it is one object's fields, written in one sitting — which is exactly
 * what the platform uses a drawer for. A wizard would ask "what sort of
 * notice?" on a screen of its own and then make somebody go back to fix a
 * typo in the title.
 *
 * Two decisions worth stating.
 *
 * **Publishing is a state, not a separate button.** "Save as draft" and
 * "Publish" as two buttons is two code paths for one write, and it makes
 * *un*-publishing something nobody thought about. Status is a control like the
 * others, so a notice can go back to a draft the same way it left.
 *
 * **The window is validated here as well as on the server.** Not because the
 * server's check is in doubt — it is the one that counts — but because
 * "expires before it is published" is a mistake somebody makes while typing,
 * and finding out after pressing Save costs the whole form's attention.
 */

import { useMutation } from "@tanstack/react-query";
import { App as AntApp, Button, Form, Modal, Space } from "antd";

import { announcementsApi, type Announcement } from "@/api/announcements";
import { ApiError } from "@/api/client";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";

import { AnnouncementFields } from "./AnnouncementFields";
import { seedValues, toInput, type FormValues } from "./editorValues";

export function AnnouncementEditor({
  open,
  notice,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** `null` for a new one. */
  notice: Announcement | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<FormValues>();
  const { touch, settled, requestClose } = useDiscardGuard({
    close: onClose,
    what: "announcement",
  });
  const { message } = AntApp.useApp();

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const input = toInput(values);
      return notice ? announcementsApi.update(notice.id, input) : announcementsApi.create(input);
    },
    onSuccess: (saved) => {
      message.success(notice ? `${saved.title} saved` : `${saved.title} written`);
      settled();
      onSaved();
    },
    onError: (error) =>
      message.error(
        error instanceof ApiError ? error.message : "That announcement could not be saved.",
      ),
  });

  /**
   * Seed the form each time it opens.
   *
   * `initialValues` is read once per mounted form and this drawer outlives a
   * close, so without this, opening it on a second notice would show the
   * first one's text.
   */
  const seed = () => form.setFieldsValue(seedValues(notice));

  return (
    <Modal
      open={open}
      width={680}
      title={
        notice ? (
          `Edit “${notice.title}”`
        ) : (
          <div className="nx-ov-modal-title">
            <span>
              New <em>announcement</em>
            </span>
            <small>Shown to everyone it is addressed to, from the date you choose</small>
          </div>
        )
      }
      afterOpenChange={(opened) => opened && seed()}
      onCancel={requestClose}
      destroyOnHidden={false}
      className="nx-ov-announce-editor"
      footer={
        <Space>
          <Button onClick={requestClose}>Cancel</Button>
          <Button
            type="primary"
            loading={save.isPending}
            onClick={() => void form.submit()}
            data-testid="save-announcement"
          >
            {notice ? "Save changes" : "Write it"}
          </Button>
        </Space>
      }
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onValuesChange={touch}
        onFinish={(values) => save.mutate(values)}
      >
        <AnnouncementFields />
      </Form>
    </Modal>
  );
}

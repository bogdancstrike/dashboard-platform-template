import { useEffect, useState } from "react";
import { Form, Input, Modal } from "antd";

/**
 * The plain modal, for a create whose whole decision is one word (§33, §10).
 *
 * Three shapes open a create in this platform and each is right for a
 * different size of decision: a **wizard** where the decision has parts (a
 * dashboard, an import), a **drawer** for one object's fields (a record, an
 * automation, an export), and this — a modal, for the ones that ask one
 * question. A drawer for "what is the folder called" is a 520-pixel panel
 * sliding in to collect eight characters.
 *
 * It exists as a component because the two places that asked one question were
 * doing it with `modal.confirm` and an *uncontrolled* input, and both had the
 * same three defects: pressing Enter closed nothing, an empty name created
 * nothing and said nothing, and a name of spaces was accepted. A confirm
 * dialog is for confirming; a form is for a value, however small the value is.
 */
export function NameModal({
  open,
  title,
  label,
  placeholder,
  initial = "",
  okText = "Create",
  saving = false,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  /** The field's accessible name — "Folder name", "Lane name". */
  label: string;
  placeholder?: string;
  /** For a rename: what it is called now. */
  initial?: string;
  okText?: string;
  saving?: boolean;
  onClose: () => void;
  /** Called with the trimmed value; never with an empty one. */
  onSubmit: (name: string) => void;
}) {
  const [form] = Form.useForm<{ name: string }>();
  const [name, setName] = useState(initial);

  // Reset on each open rather than on mount: the modal is kept mounted so it
  // can animate, and without this the second folder arrives pre-filled with
  // the first one's name.
  useEffect(() => {
    if (open) {
      setName(initial);
      form.setFieldsValue({ name: initial });
    }
  }, [open, initial, form]);

  const submit = () => {
    const value = name.trim();
    if (!value) {
      // Said, not swallowed. The `confirm` version closed on OK and created
      // nothing, which reads as a broken button.
      void form.validateFields();
      return;
    }
    onSubmit(value);
  };

  return (
    <Modal
      open={open}
      title={title}
      okText={okText}
      confirmLoading={saving}
      onCancel={onClose}
      onOk={submit}
      destroyOnClose={false}
      okButtonProps={{ "data-testid": "name-modal-ok" }}
    >
      <Form form={form} layout="vertical" initialValues={{ name: initial }} onFinish={submit}>
        <Form.Item
          name="name"
          label={label}
          rules={[
            // Trimmed, so a name of spaces is refused rather than stored as
            // an untitled folder nobody can find again.
            { required: true, whitespace: true, message: `${label} is required` },
            { max: 120, message: `${label} is at most 120 characters` },
          ]}
        >
          <Input
            autoFocus
            aria-label={label}
            placeholder={placeholder}
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            // Enter submits, because a one-field form that needs the mouse is
            // a one-field form that should not have been a dialog.
            onPressEnter={(event) => {
              event.preventDefault();
              submit();
            }}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

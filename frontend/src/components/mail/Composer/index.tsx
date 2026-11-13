/**
 * Writing a message (§16).
 *
 * Three decisions worth stating.
 *
 * **Save and Send are both offered, and neither is hidden.** A composer with
 * only Send makes somebody choose between finishing now and losing what they
 * wrote. A draft is a message in the same table, so saving is cheap and
 * offering it costs a button.
 *
 * **Sending says where it goes.** There is no mail transport in this template
 * and the message lands in Outbox; a Send button that implied delivery would
 * be the composer lying about the one thing it is for.
 *
 * **A template fills what is blank and never overwrites what was typed**, and
 * the *server* does the filling — `{{ name }}` and `{{name}}` are the same
 * placeholder, and a second implementation here would disagree the first time
 * somebody wrote a space. What it could not fill is named before the send,
 * rather than discovered by a customer receiving "Dear {{ name }}".
 */

import { Alert, Button, Form, Input, Modal, Select, Space, Typography } from "antd";

import { type MailMessage, type MailThread } from "@/api/mail";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";

import { type FormValues, unfilledPlaceholders } from "./compose";
import { useComposerActions } from "./useComposerActions";

export { replyDefaults, unfilledPlaceholders } from "./compose";

const { Text } = Typography;

export function Composer({
  open,
  /** The conversation being replied to, when there is one. */
  thread,
  /** The draft being edited, when there is one. */
  draft,
  meEmail,
  /**
   * The priorities the server declares, published with every folder listing.
   * Passed in rather than listed here: `core/vocabulary.EMAIL_PRIORITY` is the
   * one place, and a composer offering a fourth value the server refuses is a
   * composer that fails on save.
   */
  priorities,
  onClose,
  onSaved,
}: {
  open: boolean;
  thread: MailThread | null;
  draft: MailMessage | null;
  meEmail: string | null;
  priorities: string[];
  onClose: () => void;
  onSaved: (thread: MailThread) => void;
}) {
  const [form] = Form.useForm<FormValues>();
  // An email half-written is the clearest case there is for asking (§74): a
  // click outside the dialog would otherwise throw away prose.
  const { touch, settled, requestClose } = useDiscardGuard({
    close: onClose,
    what: "message",
  });
  const { template, setTemplate, templates, apply, save, submit } = useComposerActions({
    form, open, draft, thread, meEmail, settled, onSaved,
  });
  const body = (Form.useWatch("body", form) as string | undefined) ?? "";

  const stillNeeded = unfilledPlaceholders(body);

  return (
    <Modal
      open={open}
      width={720}
      title={draft ? "Edit draft" : thread ? "Reply" : "New message"}
      onCancel={requestClose}
      footer={
        <Space>
          <Button
            onClick={() => void submit(false)}
            loading={save.isPending}
            data-testid="save-draft"
          >
            Save as draft
          </Button>
          <Button
            type="primary"
            onClick={() => void submit(true)}
            loading={save.isPending}
            data-testid="send"
          >
            Send
          </Button>
        </Space>
      }
    >
      {/* Said on the way in, not discovered afterwards. */}
      <Alert
        className="nu-block"
        type="info"
        showIcon
        message="Sending puts this in your Outbox"
        description="There is no mail transport in this template, so nothing will deliver it. It is stored exactly as it would be sent."
      />

      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onValuesChange={touch}
        data-testid="composer"
      >
        <Form.Item
          name="to"
          label="To"
          rules={[{ required: true, message: "A message needs somebody to go to" }]}
        >
          <Select
            mode="tags"
            aria-label="To"
            placeholder="somebody@example.com"
            tokenSeparators={[",", " ", ";"]}
            open={false}
          />
        </Form.Item>

        <Form.Item name="cc" label="Cc">
          <Select
            mode="tags"
            aria-label="Cc"
            placeholder="Nobody"
            tokenSeparators={[",", " ", ";"]}
            open={false}
          />
        </Form.Item>

        <div className="nu-composer-grid">
          <Form.Item
            name="subject"
            label="Subject"
            rules={[{ required: true, message: "A message needs a subject" }]}
          >
            <Input maxLength={300} placeholder="What it is about" />
          </Form.Item>

          <Form.Item name="priority" label="Priority">
            <Select
              aria-label="Priority"
              options={priorities.map((item) => ({
                value: item,
                label: item.charAt(0) + item.slice(1).toLowerCase(),
              }))}
            />
          </Form.Item>

          <Form.Item
            label="Start from a template"
            tooltip="It fills whatever you have left blank, and never replaces what you have typed."
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              aria-label="Template"
              placeholder="None"
              value={template}
              loading={templates.isLoading || apply.isPending}
              onChange={(code: string | undefined) => {
                setTemplate(code);
                if (code) apply.mutate(code);
              }}
              options={(templates.data?.items ?? []).map((item) => ({
                value: item.code,
                label: item.name,
              }))}
            />
          </Form.Item>
        </div>

        <Form.Item
          name="body"
          label="Message"
          rules={[{ required: true, message: "An empty message is not worth sending" }]}
        >
          <Input.TextArea rows={10} placeholder="Write it here." />
        </Form.Item>

        {/* Named before the send, not discovered by whoever receives it. */}
        {stillNeeded.length > 0 && (
          <Alert
            type="warning"
            showIcon
            data-testid="unfilled"
            message="This still has placeholders in it"
            description={`${stillNeeded.map((name) => `{{ ${name} }}`).join(", ")} — fill them in, or whoever receives this will see them.`}
          />
        )}

        <Text type="secondary">
          Addresses are checked when it is saved; a malformed one is refused with the
          address named.
        </Text>
      </Form>
    </Modal>
  );
}

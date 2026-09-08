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

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Typography,
} from "antd";
import { useEffect, useState } from "react";

import { ApiError } from "@/api/client";
import { mailApi, type ComposeInput, type MailMessage, type MailThread } from "@/api/mail";

const { Text } = Typography;

interface FormValues {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  priority: string;
}

/**
 * Which placeholders a body still carries.
 *
 * Pure and exported. The server answers this for a *template*; this answers it
 * for whatever is in the box now, because somebody can paste a template's text
 * and edit around the placeholders — and "you are about to send `{{ name }}`
 * to a customer" is worth saying at the moment they press Send.
 */
export function unfilledPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((hit) => hit[1]!))];
}

/** What a reply's subject and recipients start as. */
export function replyDefaults(thread: MailThread, meEmail: string | null): Partial<FormValues> {
  const messages = thread.messages ?? [];
  const last = messages[messages.length - 1];
  const from = last?.from.email;
  return {
    subject: thread.subject.startsWith("Re: ") ? thread.subject : `Re: ${thread.subject}`,
    // Whoever wrote the last message, and never the reader themselves: a reply
    // addressed back to yourself is the commonest thing a composer gets wrong.
    to: from && from.toLowerCase() !== (meEmail ?? "").toLowerCase() ? [from] : [],
    priority: "NORMAL",
  };
}

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
  const { message } = AntApp.useApp();
  const [template, setTemplate] = useState<string | undefined>();
  const body = (Form.useWatch("body", form) as string | undefined) ?? "";

  const templates = useQuery({
    queryKey: ["mail-templates"],
    queryFn: ({ signal }) => mailApi.templates(signal),
    staleTime: 300_000,
    enabled: open,
  });

  // Reset on every open: the same component writes a new message, a reply and
  // an edit to a draft, and one that kept the previous subject saves the wrong
  // thing.
  useEffect(() => {
    if (!open) return;
    setTemplate(undefined);
    if (draft) {
      form.setFieldsValue({
        to: draft.to.map((person) => person.email),
        cc: draft.cc.map((person) => person.email),
        subject: draft.subject,
        body: draft.body,
        priority: draft.priority,
      });
      return;
    }
    form.setFieldsValue({
      to: [],
      cc: [],
      subject: "",
      body: "",
      priority: "NORMAL",
      ...(thread ? replyDefaults(thread, meEmail) : {}),
    });
  }, [open, draft, thread, meEmail, form]);

  /** Fill the box from a template, on the server. */
  const apply = useMutation({
    mutationFn: (code: string) => mailApi.render(code, {}),
    onSuccess: (filled) => {
      const current = form.getFieldsValue();
      form.setFieldsValue({
        subject: current.subject || filled.subject,
        body: current.body || filled.body,
      });
      if (filled.unfilled.length > 0) {
        message.info(
          `That template still needs ${filled.unfilled.join(", ")} — fill them in before sending.`,
        );
      }
    },
    onError: (error) =>
      message.error(
        error instanceof ApiError ? error.message : "That template could not be read.",
      ),
  });

  const save = useMutation({
    mutationFn: ({ values, send }: { values: FormValues; send: boolean }) => {
      const input: ComposeInput = {
        subject: values.subject,
        body: values.body,
        to: values.to,
        cc: values.cc ?? [],
        priority: values.priority,
        send,
      };
      if (draft) return mailApi.updateMessage(draft.id, input);
      return mailApi.compose(thread ? { ...input, thread_id: thread.id } : input);
    },
    onSuccess: (saved, variables) => {
      message.success(
        variables.send
          ? "Queued — it is in your Outbox until a transport takes it"
          : "Saved as a draft",
      );
      onSaved(saved);
    },
    onError: (error) =>
      message.error(
        error instanceof ApiError ? error.message : "That message could not be saved.",
      ),
  });

  const submit = async (send: boolean) => {
    let values: FormValues;
    if (send) {
      try {
        values = await form.validateFields();
      } catch {
        // `validateFields` *rejects* when a field is empty, which is the
        // normal path here — AntD has already put the messages under the
        // fields. Uncaught, `void submit(true)` turned every empty Send into
        // an unhandled rejection: 445 tests passing and one error in the run.
        return;
      }
    } else {
      values = form.getFieldsValue();
      if (!values.subject.trim() && !values.body.trim()) {
        message.info("There is nothing to save yet.");
        return;
      }
    }
    save.mutate({ values, send });
  };

  const stillNeeded = unfilledPlaceholders(body);

  return (
    <Modal
      open={open}
      width={720}
      title={draft ? "Edit draft" : thread ? "Reply" : "New message"}
      onCancel={onClose}
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

      <Form form={form} layout="vertical" requiredMark={false} data-testid="composer">
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

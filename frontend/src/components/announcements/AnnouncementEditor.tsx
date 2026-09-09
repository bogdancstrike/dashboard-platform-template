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
import {
  Alert,
  App as AntApp,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  Segmented,
  Select,
  Space,
  Switch,
  Typography,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";

import { announcementsApi, type Announcement, type AnnouncementInput } from "@/api/announcements";
import { ApiError } from "@/api/client";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";

const { Text } = Typography;

/**
 * The categories and severities the server accepts.
 *
 * Typed out here rather than fetched: they are a *vocabulary*, not data, and
 * an extra request on every open of a drawer to learn five constants is a
 * request that fails at exactly the wrong moment. The server validates them
 * either way — `services/announcements.CATEGORIES` is the authority, and a
 * value this offers which it rejects is a 400 with the allowed list in it.
 */
const CATEGORIES = [
  { value: "MAINTENANCE", label: "Maintenance" },
  { value: "RELEASE", label: "Release" },
  { value: "INCIDENT", label: "Incident" },
  { value: "POLICY", label: "Policy" },
  { value: "NEWS", label: "News" },
];

const ROLES = [
  { value: "ADMINISTRATOR", label: "Administrators" },
  { value: "MANAGER", label: "Managers" },
  { value: "OPERATOR", label: "Operators" },
  { value: "ANALYST", label: "Analysts" },
  { value: "VIEWER", label: "Viewers" },
];

/**
 * Whether a notice's window makes sense, as a plain function.
 *
 * Exported and tested directly rather than through the picker: driving a
 * range picker in jsdom asserts AntD's keyboard handling, not this rule, and
 * it took nine seconds to do it. The server checks the same thing and its
 * answer is the one that counts (`services/announcements._validated`); this
 * exists so the mistake is caught while somebody is still typing.
 */
export function windowProblem(
  from: Dayjs | null | undefined,
  to: Dayjs | null | undefined,
): string | null {
  if (!from || !to) return null;
  return to.isAfter(from) ? null : "A notice cannot expire before it is published";
}

interface FormValues {
  title: string;
  body: string;
  category: string;
  severity: string;
  status: string;
  window?: [Dayjs | null, Dayjs | null] | null;
  audience_roles?: string[];
  requires_acknowledgement?: boolean;
  is_pinned?: boolean;
  link?: string;
}

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
      const [from, to] = values.window ?? [null, null];
      const input: AnnouncementInput = {
        title: values.title,
        body: values.body,
        category: values.category,
        severity: values.severity,
        status: values.status,
        publish_at: from ? from.toISOString() : null,
        expires_at: to ? to.toISOString() : null,
        audience_roles: values.audience_roles ?? [],
        requires_acknowledgement: Boolean(values.requires_acknowledgement),
        is_pinned: Boolean(values.is_pinned),
        link: values.link?.trim() || null,
      };
      return notice
        ? announcementsApi.update(notice.id, input)
        : announcementsApi.create(input);
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
  const seed = () =>
    form.setFieldsValue({
      title: notice?.title ?? "",
      body: notice?.body ?? "",
      category: notice?.category ?? "NEWS",
      severity: notice?.severity ?? "INFO",
      status: notice?.status ?? "DRAFT",
      window: [
        notice?.publish_at ? dayjs(notice.publish_at) : dayjs(),
        notice?.expires_at ? dayjs(notice.expires_at) : null,
      ],
      audience_roles: notice?.audience_roles ?? [],
      requires_acknowledgement: notice?.requires_acknowledgement ?? false,
      is_pinned: notice?.is_pinned ?? false,
      link: notice?.link ?? "",
    });

  return (
    <Drawer
      open={open}
      width={560}
      title={notice ? `Edit “${notice.title}”` : "Write an announcement"}
      afterOpenChange={(opened) => opened && seed()}
      onClose={requestClose}
      destroyOnClose={false}
      extra={
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
        <Form.Item
          name="title"
          label="Title"
          rules={[{ required: true, message: "A notice needs a title" }]}
        >
          <Input
            placeholder="Scheduled maintenance this Sunday, 02:00–04:00 UTC"
            aria-label="Title"
          />
        </Form.Item>

        <Form.Item name="body" label="What it says">
          <Input.TextArea
            rows={6}
            aria-label="What it says"
            placeholder="What is happening, when, and what the reader needs to do about it."
          />
        </Form.Item>

        <Space size={12} className="nu-block" wrap>
          <Form.Item name="category" label="Kind of notice" style={{ marginBottom: 0 }}>
            <Select aria-label="Kind of notice" style={{ width: 170 }} options={CATEGORIES} />
          </Form.Item>
          <Form.Item name="severity" label="How loudly" style={{ marginBottom: 0 }}>
            <Segmented
              aria-label="How loudly"
              options={[
                { value: "INFO", label: "Info" },
                { value: "WARNING", label: "Warning" },
                { value: "CRITICAL", label: "Critical" },
              ]}
            />
          </Form.Item>
        </Space>

        <Form.Item
          name="window"
          label="Live from, and until"
          // Checked here as well as on the server: it is a mistake somebody
          // makes while typing, and finding out after Save costs the form's
          // attention. The server's check is still the one that counts.
          rules={[
            {
              validator: (_rule, value: [Dayjs | null, Dayjs | null] | null | undefined) => {
                const [from, to] = value ?? [null, null];
                const problem = windowProblem(from, to);
                return problem ? Promise.reject(new Error(problem)) : Promise.resolve();
              },
            },
          ]}
          extra="Leave the end empty for a notice that does not run out — a policy is not a window."
        >
          <DatePicker.RangePicker
            showTime
            allowEmpty={[true, true]}
            style={{ width: "100%" }}
            aria-label="Live from, and until"
          />
        </Form.Item>

        <Form.Item
          name="audience_roles"
          label="Who sees it"
          extra="Nothing chosen means everybody — which is what a notice usually is."
        >
          <Select
            mode="multiple"
            allowClear
            aria-label="Who sees it"
            placeholder="Everybody"
            options={ROLES}
          />
        </Form.Item>

        <Form.Item name="link" label="Where to go to act on it">
          <Input placeholder="/settings/system" aria-label="Where to go to act on it" />
        </Form.Item>

        <Space size={24} wrap>
          <Form.Item
            name="requires_acknowledgement"
            label="Ask for a response"
            valuePropName="checked"
            extra="Adds a button the reader has to press"
          >
            <Switch />
          </Form.Item>
          <Form.Item
            name="is_pinned"
            label="Hold at the top"
            valuePropName="checked"
            extra="Use it for one notice at a time"
          >
            <Switch />
          </Form.Item>
        </Space>

        {/* Publishing is a state rather than a second button: two buttons for
            one write is two code paths, and un-publishing becomes a thing
            nobody thought about. */}
        <Form.Item name="status" label="State">
          <Segmented
            aria-label="State"
            data-testid="announcement-status"
            options={[
              { value: "DRAFT", label: "Draft" },
              { value: "SCHEDULED", label: "Scheduled" },
              { value: "PUBLISHED", label: "Published" },
              { value: "ARCHIVED", label: "Archived" },
            ]}
          />
        </Form.Item>

        <Alert
          type="info"
          showIcon
          message="Published means live from the date above"
          description={
            <Text type="secondary">
              A notice whose start is in the future is shown as scheduled and appears on its own,
              so there is nothing to remember to come back and do.
            </Text>
          }
        />
      </Form>
    </Drawer>
  );
}

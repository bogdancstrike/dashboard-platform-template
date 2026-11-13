import { Alert, DatePicker, Form, Input, Segmented, Select, Space, Switch, Typography } from "antd";
import type { Dayjs } from "dayjs";

import { CATEGORIES, ROLES, windowProblem } from "./editorValues";

const { Text } = Typography;

/** The editor's fields, in the order somebody writes a notice. */
export function AnnouncementFields() {
  return (
    <>
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
            A notice whose start is in the future is shown as scheduled and appears on its own, so
            there is nothing to remember to come back and do.
          </Text>
        }
      />
    </>
  );
}

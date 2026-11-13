import { Form, Input, Segmented, type FormInstance } from "antd";

import type { DashboardScope } from "@/api/dashboards";
import { MemberPicker } from "@/components/PeoplePicker";

export interface Details {
  name: string;
  description?: string;
  scope: DashboardScope;
  member_ids?: string[];
}

/** Step one: what the dashboard is called, what it is for, and who sees it. */
export function DetailsStep({
  form,
  initialValues,
  canShare,
  touch,
}: {
  form: FormInstance<Details>;
  initialValues: Details;
  canShare: boolean;
  /** Arms the discard guard: a typed name is worth asking about. */
  touch: () => void;
}) {
  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={initialValues}
      onValuesChange={touch}
      data-testid="wizard-details"
    >
      <Form.Item
        name="name"
        label="Name"
        rules={[{ required: true, message: "Give it a name people will recognise" }]}
      >
        <Input placeholder="Support desk" autoFocus maxLength={80} />
      </Form.Item>
      <Form.Item name="description" label="What it is for">
        <Input.TextArea rows={2} maxLength={240} placeholder="Optional" />
      </Form.Item>
      <Form.Item name="scope" label="Who can see it">
        <Segmented
          options={[
            { value: "PRIVATE", label: "Only me" },
            { value: "SHARED", label: "Named people", disabled: !canShare },
            { value: "PUBLIC", label: "Everyone", disabled: !canShare },
          ]}
        />
      </Form.Item>
      <Form.Item
        noStyle
        shouldUpdate={(before: { scope?: string }, after: { scope?: string }) =>
          before.scope !== after.scope
        }
      >
        {({ getFieldValue }) =>
          (getFieldValue("scope") as string) === "SHARED" ? (
            <Form.Item name="member_ids" label="Shared with">
              <MemberPicker placeholder="Search colleagues" />
            </Form.Item>
          ) : null
        }
      </Form.Item>
    </Form>
  );
}

import { Button, Drawer, Form, Input, Segmented, Select, Switch } from "antd";

import { dashboardsApi, type DashboardScope, type SavedDashboard } from "@/api/dashboards";
import { MemberPicker } from "@/components/PeoplePicker";
import { asText } from "@/lib/text";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";

/** The dashboard itself: its name, who sees it, and whether it is home. */
export function SettingsDrawer({
  open,
  dashboard,
  saving,
  canShare,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  dashboard: SavedDashboard | undefined;
  saving: boolean;
  canShare: boolean;
  onClose: () => void;
  onSave: (input: Parameters<typeof dashboardsApi.update>[1]) => void;
  onDelete: () => void;
}) {
  const [form] = Form.useForm();
  const { touch, requestClose } = useDiscardGuard({ close: onClose, what: "dashboard" });
  if (!dashboard) return null;

  return (
    <Drawer
      open={open}
      onClose={requestClose}
      width={420}
      destroyOnClose
      title={`Settings — ${dashboard.name}`}
      extra={
        <Button
          type="primary"
          loading={saving}
          onClick={() => void form.submit()}
          data-testid="save-dashboard"
        >
          Save
        </Button>
      }
      footer={
        <Button danger onClick={onDelete} data-testid="delete-dashboard">
          Delete this dashboard
        </Button>
      }
    >
      <Form
        form={form}
        layout="vertical"
        onValuesChange={touch}
        initialValues={{
          name: dashboard.name,
          description: dashboard.description ?? "",
          scope: dashboard.scope,
          is_home: dashboard.is_home,
          period: asText(dashboard.filters["period"]) || "last_30_days",
          member_ids: dashboard.members.map((member) => member.id),
        }}
        onFinish={(values: {
          name: string;
          description?: string;
          scope: DashboardScope;
          is_home?: boolean;
          period?: string;
          member_ids?: string[];
        }) =>
          onSave({
            name: values.name,
            description: values.description || null,
            scope: values.scope,
            is_home: values.is_home ?? false,
            filters: { period: values.period ?? "last_30_days" },
            member_ids: values.member_ids ?? [],
          })
        }
      >
        <Form.Item name="name" label="Name" rules={[{ required: true, message: "Give it a name" }]}>
          <Input />
        </Form.Item>
        <Form.Item name="description" label="What it is for">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item
          name="period"
          label="Period"
          extra="Every widget that names no period of its own follows this."
        >
          <Select
            aria-label="Dashboard period"
            options={[
              { value: "all_time", label: "All time" },
              { value: "last_7_days", label: "Last 7 days" },
              { value: "last_30_days", label: "Last 30 days" },
              { value: "last_90_days", label: "Last 90 days" },
              { value: "last_365_days", label: "Last 365 days" },
            ]}
          />
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
        <Form.Item
          name="is_home"
          label="My home dashboard"
          valuePropName="checked"
          extra="One at a time — choosing this one releases the last (§67)."
        >
          <Switch />
        </Form.Item>
      </Form>
    </Drawer>
  );
}

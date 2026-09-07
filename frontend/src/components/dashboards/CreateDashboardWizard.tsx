/**
 * Creating a dashboard, in three steps (§10, §45).
 *
 * A wizard rather than a form, and rather than the drawer the platform uses
 * for editing one record. The distinction is not decoration: **a drawer edits
 * an object that already exists, a wizard makes a decision that has parts.**
 * Naming a dashboard, choosing what it will hold and deciding who sees it are
 * three separate thoughts, and a single form of eleven controls asks all three
 * at once and gets a worse answer to each.
 *
 * Two decisions worth stating.
 *
 * **It cannot be finished empty.** A dashboard is created in order to hold
 * something; ending the flow on an empty grid has stopped one step short. So
 * step two requires at least one widget and the Next button says so.
 *
 * **The last step shows what will be made.** Not a summary of the form — the
 * widgets in the order they will be laid out, which is the thing the reader
 * has been choosing and has not yet seen.
 */

import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Segmented,
  Space,
  Steps,
  Tag,
  Typography,
} from "antd";
import { useState } from "react";

import { ApiError } from "@/api/client";
import {
  dashboardsApi,
  type DashboardScope,
  type SavedDashboard,
  type WidgetKind,
} from "@/api/dashboards";
import { MemberPicker } from "@/components/PeoplePicker";

import { KINDS } from "./kinds";
import { WidgetKindPicker } from "./WidgetKindPicker";

const { Text } = Typography;

interface Details {
  name: string;
  description?: string;
  scope: DashboardScope;
  member_ids?: string[];
}

export function CreateDashboardWizard({
  open,
  canShare,
  unavailable,
  onClose,
  onCreated,
}: {
  open: boolean;
  canShare: boolean;
  /** Kinds this reader cannot pick yet, and why. */
  unavailable: Partial<Record<WidgetKind, string>>;
  onClose: () => void;
  onCreated: (dashboard: SavedDashboard) => void;
}) {
  const [step, setStep] = useState(0);
  const [details, setDetails] = useState<Details>({ name: "", scope: "PRIVATE" });
  const [kinds, setKinds] = useState<WidgetKind[]>([]);
  const [form] = Form.useForm<Details>();

  const reset = () => {
    setStep(0);
    setDetails({ name: "", scope: "PRIVATE" });
    setKinds([]);
    form.resetFields();
  };

  const create = useMutation({
    mutationFn: () =>
      dashboardsApi.create({
        ...details,
        // One request, so a dashboard is never half-built: the server lays the
        // widgets out with the same rule the grid's own compaction uses.
        widgets: kinds.map((kind) => ({ kind })),
      }),
    onSuccess: (saved) => {
      onCreated(saved);
      reset();
    },
  });

  const advance = async () => {
    if (step === 0) {
      const values = await form.validateFields();
      setDetails((current) => ({ ...current, ...values }));
      setStep(1);
      return;
    }
    if (step === 1) {
      setStep(2);
      return;
    }
    create.mutate();
  };

  const steps = [
    { title: "Name it", description: "What it is for" },
    { title: "Fill it", description: "What it will hold" },
    { title: "Check it", description: "Then create" },
  ];

  return (
    <Modal
      open={open}
      width={720}
      title="New dashboard"
      onCancel={() => {
        reset();
        onClose();
      }}
      footer={
        <Space>
          {step > 0 && (
            <Button onClick={() => setStep(step - 1)} data-testid="wizard-back">
              Back
            </Button>
          )}
          <Button
            type="primary"
            loading={create.isPending}
            disabled={step === 1 && kinds.length === 0}
            onClick={() => void advance()}
            data-testid="wizard-next"
          >
            {step === 2 ? "Create" : "Next"}
          </Button>
        </Space>
      }
    >
      <Steps current={step} items={steps} size="small" className="nu-block" />

      {create.error instanceof ApiError && (
        <Alert
          className="nu-block"
          type="error"
          showIcon
          message={create.error.message}
          description={
            <Text code copyable={{ text: create.error.correlationId }}>
              {create.error.correlationId}
            </Text>
          }
        />
      )}

      {step === 0 && (
        <Form form={form} layout="vertical" initialValues={details} data-testid="wizard-details">
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
      )}

      {step === 1 && (
        <>
          <Text type="secondary" className="nu-block">
            Every widget asks the platform the same question the page behind it
            would. You can change what each one shows once it is on the grid.
          </Text>
          <WidgetKindPicker chosen={kinds} onChange={setKinds} unavailable={unavailable} />
        </>
      )}

      {step === 2 && (
        <div data-testid="wizard-review">
          <Text strong>{details.name}</Text>
          {details.description && (
            <Text type="secondary" style={{ display: "block" }}>
              {details.description}
            </Text>
          )}
          <Text type="secondary" style={{ display: "block", marginTop: 4 }}>
            {details.scope === "PRIVATE"
              ? "Only you will see it"
              : details.scope === "PUBLIC"
                ? "Everyone signed in will see it"
                : "Shared with the people you named"}
          </Text>

          {/* The widgets in the order they will be laid out — the thing the
              reader has been choosing and has not yet seen. */}
          <Space size={[6, 6]} wrap className="nu-block">
            {kinds.map((kind, index) => (
              <Tag key={`${kind}-${index}`} color={KINDS[kind].colour} bordered={false}>
                {KINDS[kind].label}
              </Tag>
            ))}
          </Space>
          <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
            {kinds.length} {kinds.length === 1 ? "widget" : "widgets"}, laid out left to right.
            Nothing is filled in yet — each one opens its own settings on the grid.
          </Text>
        </div>
      )}
    </Modal>
  );
}

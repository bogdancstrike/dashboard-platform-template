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
import { Alert, Button, Form, Modal, Space, Steps, Typography } from "antd";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { dashboardsApi, type SavedDashboard, type WidgetKind } from "@/api/dashboards";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";

import { DetailsStep, type Details } from "./wizard/DetailsStep";
import { ReviewStep } from "./wizard/ReviewStep";
import { WidgetKindPicker } from "./WidgetKindPicker";

const { Text } = Typography;


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
  // Several steps of choices, thrown away by a click outside the dialog — the
  // clearest case for asking first (§74).
  const { touch, settled, requestClose } = useDiscardGuard({
    close: () => {
      reset();
      onClose();
    },
    what: "dashboard",
  });

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
      settled();
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
      title={
        <div className="nx-ov-modal-title">
          <span>
            Create <em>dashboard</em>
          </span>
          <small>
            Step {step + 1} of 3 · {steps[step]?.description.toLowerCase()}
          </small>
        </div>
      }
      onCancel={requestClose}
      footer={
        <Space>
          <Button onClick={requestClose}>Cancel</Button>
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
      <Steps current={step} items={steps} size="small" className="nu-block nx-ov-steps" />

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
        <DetailsStep form={form} initialValues={details} canShare={canShare} touch={touch} />
      )}

      {step === 1 && (
        <>
          <Text type="secondary" className="nu-block">
            Every widget asks the platform the same question the page behind it
            would. You can change what each one shows once it is on the grid.
          </Text>
          {/* Choosing cards is an edit too, so it arms the guard: three
              chosen kinds thrown away by a click outside is the same loss as
              a typed name. */}
          <WidgetKindPicker
            chosen={kinds}
            onChange={(next) => {
              touch();
              setKinds(next);
            }}
            unavailable={unavailable}
          />
        </>
      )}

      {step === 2 && <ReviewStep details={details} kinds={kinds} />}
    </Modal>
  );
}

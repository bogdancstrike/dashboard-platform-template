/**
 * Creating an automation, in four steps (§10, §49).
 *
 * A wizard, and the platform now has one of each: a wizard where the decision
 * has parts, a drawer for one object's fields, a plain modal for one question.
 * An automation is squarely the first — *what it watches*, *when it fires* and
 * *what it does* are three separate thoughts, and a single form of fourteen
 * controls asks all three at once and gets a worse answer to each.
 *
 * Two decisions worth stating.
 *
 * **The dataset is chosen first and cannot change afterwards in this flow.**
 * A condition is written against one dataset's fields; changing the dataset
 * halfway invalidates every rule already written, and a wizard that silently
 * discards the reader's work is worse than one that asks in the right order.
 *
 * **It is created paused, and the last step is a rehearsal.** A rule that
 * starts firing the moment it is saved has never been checked against real
 * data — and the whole reason §49 asks for a dry run is that the first version
 * of a condition is usually wrong. So: create, rehearse, then switch on.
 */

import { Alert, Button, Form, Input, Modal, Segmented, Select, Space, Steps } from "antd";

import type { AutomationCatalogue, AutomationRule } from "@/api/automations";
import { emptyTree } from "@/components/explorer/queryTree";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";

import { ActionListEditor } from "../ActionListEditor";
import { ConditionStep, RehearsalStep } from "./WizardSteps";
import { useAutomationWizard } from "./useAutomationWizard";
import { STEPS, type Details } from "./wizardRules";

export { stepProblem } from "./wizardRules";

export function AutomationWizard({
  open,
  catalogue,
  onClose,
  onCreated,
}: {
  open: boolean;
  catalogue: AutomationCatalogue;
  onClose: () => void;
  onCreated: (rule: AutomationRule) => void;
}) {
  const [form] = Form.useForm<Details>();
  // Several steps of choices, thrown away by a click outside the dialog — the
  // clearest case for asking first (§74).
  const { touch, settled, requestClose } = useDiscardGuard({
    close: () => {
      wizard.reset();
      onClose();
    },
    what: "automation",
  });
  const wizard = useAutomationWizard({ open, catalogue, form, onCreated, settled });
  const { step, setStep, details, setDetails, setCondition, problem, create, advance } = wizard;

  return (
    <Modal
      open={open}
      width={860}
      title="New automation"
      onCancel={requestClose}
      footer={
        <Space>
          {step > 0 && step < 3 && (
            <Button onClick={() => setStep(step - 1)} data-testid="wizard-back">
              Back
            </Button>
          )}
          <Button
            type="primary"
            loading={create.isPending}
            disabled={problem !== null}
            onClick={() => void advance()}
            data-testid="wizard-next"
          >
            {step === 2 ? "Create it, paused" : step === 3 ? "Open it" : "Next"}
          </Button>
        </Space>
      }
    >
      <Steps current={step} items={STEPS} size="small" className="nu-block" />

      {/* The reason the button is disabled, beside the button rather than
          discovered by pressing it (§76). */}
      {problem && step < 3 && (
        <Alert className="nu-block" type="info" showIcon message={problem} />
      )}

      {step === 0 && (
        <Form
          form={form}
          layout="vertical"
          initialValues={details}
          onValuesChange={touch}
          data-testid="wizard-details"
        >
          <Form.Item
            name="name"
            label="What is it watching for?"
            rules={[{ required: true, message: "Give it a name somebody will recognise" }]}
          >
            <Input placeholder="Tickets breaching their SLA" autoFocus maxLength={120} />
          </Form.Item>
          <Form.Item name="description" label="Anything worth saying about why it exists">
            <Input.TextArea
              rows={2}
              maxLength={400}
              placeholder="Agreed with support in March. Deliberately noisy — it is the last line before a customer notices."
            />
          </Form.Item>
          <Form.Item
            name="resource_type"
            label="Which records"
            extra="Chosen first, because the condition is written against this dataset's own fields."
          >
            {/* No `aria-label`: `Form.Item` already labels this control by
                `for`/`id`, and a second name means the visible label and the
                announced one can disagree — which is exactly what happened
                (the field was reachable as "Dataset" and read as "Which
                records"). */}
            <Select
              showSearch
              optionFilterProp="label"
              options={catalogue.resources.map((item) => ({
                value: item.key,
                label: item.label,
              }))}
              onChange={(key: string) => {
                setDetails((current) => ({ ...current, resource_type: key }));
                setCondition(emptyTree());
              }}
            />
          </Form.Item>
          <Form.Item name="severity" label="How loud">
            <Segmented
              data-testid="wizard-severity"
              options={catalogue.severities.map((item) => ({
                value: item,
                label: item.charAt(0) + item.slice(1).toLowerCase(),
              }))}
            />
          </Form.Item>
        </Form>
      )}

      {step === 1 && <ConditionStep resource={wizard.resource} condition={wizard.condition} setCondition={setCondition} />}

      {step === 2 && (
        <ActionListEditor catalogue={catalogue} value={wizard.actions} onChange={wizard.setActions} />
      )}

      {step === 3 && <RehearsalStep created={wizard.created} rehearsal={wizard.rehearsal} />}
    </Modal>
  );
}

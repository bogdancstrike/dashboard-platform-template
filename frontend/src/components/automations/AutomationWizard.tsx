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

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Steps,
  Typography,
} from "antd";
import { useState } from "react";

import {
  automationsApi,
  type AutomationAction,
  type AutomationCatalogue,
  type AutomationRule,
  type AutomationRun,
} from "@/api/automations";
import { ApiError } from "@/api/client";
import { explorerApi } from "@/api/explorer";
import { AdvancedQueryBuilder } from "@/components/explorer/AdvancedQueryBuilder";
import { emptyTree, type QueryNode } from "@/components/explorer/queryTree";
import {
  ActionListEditor,
  actionProblem,
  blankAction,
} from "@/components/automations/ActionListEditor";
import { RunReport } from "@/components/automations/RunReport";

const { Text } = Typography;

interface Details {
  name: string;
  description?: string;
  resource_type: string;
  severity: string;
}

/**
 * Why the wizard cannot advance from a given step, or null when it can.
 *
 * Pure and exported: "you may not save an automation that reaches nobody" is a
 * rule worth asserting directly rather than by driving three dialogs, and the
 * button's disabled state and its explanation then come from one place instead
 * of drifting apart.
 */
export function stepProblem(
  step: number,
  state: { condition: QueryNode | null; actions: AutomationAction[]; needs: Map<string, string[]> },
): string | null {
  if (step === 1) {
    const rules = countRules(state.condition);
    if (rules === 0) {
      return "Add at least one condition — an automation with none matches nothing.";
    }
    return null;
  }
  if (step === 2) {
    if (state.actions.length === 0) return "Add at least one action.";
    for (const action of state.actions) {
      const problem = actionProblem(action, state.needs.get(action.kind) ?? []);
      if (problem) return problem;
    }
  }
  return null;
}

/** Complete rules in a tree — the browser's count, for enabling a button. */
function countRules(tree: QueryNode | null): number {
  if (!tree) return 0;
  const node = tree as { type?: string; children1?: unknown; properties?: { field?: string } };
  if ((node.type ?? "group") === "rule") return node.properties?.field ? 1 : 0;
  const children = node.children1;
  const list = Array.isArray(children)
    ? children
    : children && typeof children === "object"
      ? Object.values(children)
      : [];
  return list.reduce<number>((total, child) => total + countRules(child as QueryNode), 0);
}

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
  const { message } = AntApp.useApp();
  const [step, setStep] = useState(0);
  const [details, setDetails] = useState<Details>({
    name: "",
    resource_type: catalogue.resources[0]?.key ?? "task",
    severity: "WARNING",
  });
  const [condition, setCondition] = useState<QueryNode | null>(null);
  const [actions, setActions] = useState<AutomationAction[]>([blankAction("NOTIFY")]);
  const [created, setCreated] = useState<AutomationRule | null>(null);
  const [rehearsal, setRehearsal] = useState<AutomationRun | null>(null);

  const fields = useQuery({
    queryKey: ["explorer-catalogue"],
    queryFn: ({ signal }) => explorerApi.catalogue(signal),
    staleTime: 60_000,
    enabled: open,
  });
  const resource = fields.data?.items.find((item) => item.key === details.resource_type);

  const needs = new Map(catalogue.actions.map((item) => [item.kind, item.needs]));

  const reset = () => {
    form.resetFields();
    setStep(0);
    setCondition(null);
    setActions([blankAction("NOTIFY")]);
    setCreated(null);
    setRehearsal(null);
  };

  const create = useMutation({
    mutationFn: () =>
      automationsApi.create({
        name: details.name,
        description: details.description,
        resource_type: details.resource_type,
        severity: details.severity as AutomationRule["severity"],
        condition_tree: condition,
        actions,
        // Paused: the next step rehearses it, and switching it on is a
        // decision somebody makes after seeing what it would do.
        enabled: false,
      }),
    onSuccess: async (rule) => {
      setCreated(rule);
      setStep(3);
      // Rehearsed immediately, because "what would this have done" is the
      // question the reader has at exactly this moment.
      try {
        setRehearsal(await automationsApi.run(rule.id, true));
      } catch {
        // A rehearsal that fails is not a creation that failed: the rule is
        // saved, and the drawer can rehearse it again.
        setRehearsal(null);
      }
    },
    onError: (error) =>
      message.error(
        error instanceof ApiError ? error.message : "That automation could not be created.",
      ),
  });

  const problem = stepProblem(step, { condition, actions, needs });

  const advance = async () => {
    if (step === 0) {
      const values = await form.validateFields();
      setDetails((current) => ({ ...current, ...values }));
      // A fresh tree for the chosen dataset: a condition carried over from a
      // different one names fields this dataset does not have.
      setCondition((current) => current ?? emptyTree());
      setStep(1);
      return;
    }
    if (step === 1) {
      setStep(2);
      return;
    }
    if (step === 2) {
      create.mutate();
      return;
    }
    if (created) onCreated(created);
    reset();
  };

  const steps = [
    { title: "Watch", description: "Which records" },
    { title: "When", description: "The condition" },
    { title: "Then", description: "What it does" },
    { title: "Check", description: "A rehearsal" },
  ];

  return (
    <Modal
      open={open}
      width={860}
      title="New automation"
      onCancel={() => {
        reset();
        onClose();
      }}
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
      <Steps current={step} items={steps} size="small" className="nu-block" />

      {/* The reason the button is disabled, beside the button rather than
          discovered by pressing it (§76). */}
      {problem && step < 3 && (
        <Alert className="nu-block" type="info" showIcon message={problem} />
      )}

      {step === 0 && (
        <Form form={form} layout="vertical" initialValues={details} data-testid="wizard-details">
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

      {step === 1 &&
        (resource ? (
          <div data-testid="wizard-condition">
            <AdvancedQueryBuilder
              fields={resource.fields}
              value={condition}
              onChange={setCondition}
            />
            <Text type="secondary">
              The same editor the advanced search uses, and the same compiler — so a
              condition that finds the right rows here finds them there too.
            </Text>
          </div>
        ) : (
          <Alert type="warning" showIcon message="That dataset has no fields to search." />
        ))}

      {step === 2 && (
        <ActionListEditor catalogue={catalogue} value={actions} onChange={setActions} />
      )}

      {step === 3 && (
        <Space direction="vertical" size={12} className="nu-block" data-testid="wizard-rehearsal">
          <Alert
            type="success"
            showIcon
            message={`${created?.name} was created, paused`}
            description="Nothing has been sent. Below is what it would have done to the records that exist right now — switch it on from the drawer when it looks right."
          />
          {rehearsal ? (
            <RunReport run={rehearsal} dense />
          ) : (
            <Text type="secondary">The rehearsal could not be run. Try it from the drawer.</Text>
          )}
        </Space>
      )}
    </Modal>
  );
}

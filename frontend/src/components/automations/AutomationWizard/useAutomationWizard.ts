import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App as AntApp, type FormInstance } from "antd";

import { automationsApi, type AutomationAction, type AutomationCatalogue, type AutomationRule, type AutomationRun } from "@/api/automations";
import { explorerApi } from "@/api/explorer";
import { emptyTree, type QueryNode } from "@/components/explorer/queryTree";
import { apiMessageToast } from "@/lib/errors";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { blankAction } from "../ActionListEditor";
import { stepProblem, type Details } from "./wizardRules";

interface WizardContext {
  open: boolean;
  catalogue: AutomationCatalogue;
  form: FormInstance<Details>;
  onCreated: (rule: AutomationRule) => void;
  /** Called once the rule exists, so closing no longer asks about discarding it. */
  settled: () => void;
}

/** The wizard's choices, step by step, and creating the rule paused then rehearsing it. */
export function useAutomationWizard({ open, catalogue, form, onCreated, settled }: WizardContext) {
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
    queryKey: queryKeys.explorerCatalogue(),
    queryFn: ({ signal }) => explorerApi.catalogue(signal),
    staleTime: STALE.minute,
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
      settled();
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
    onError: apiMessageToast(message, "That automation could not be created."),
  });

  const problem = stepProblem(step, { condition, actions, needs });

  const advance = async () => {
    if (step === 0) {
      // A missing name is shown on the field; the rejection is not an error
      // anybody needs to hear about twice (it surfaced as an unhandled one).
      const values = await form.validateFields().catch(() => null);
      if (!values) return;
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


  return { step, setStep, details, setDetails, condition, setCondition, actions, setActions, created, rehearsal, resource, create, problem, advance, reset };
}

/**
 * The contract form (§13), for a new contract and for an edit. A drawer whose
 * open state the page keeps in the address (`?contract=new`, `?edit=1`).
 */
import "@/styles/analytics.css";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, DatePicker, Drawer, Form, Input, InputNumber, Select, Switch } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useState } from "react";

import { URL_OVERLAY } from "@/app/history";
import { explorerApi } from "@/api/explorer";
import {
  contractsApi,
  STAGE_LABEL,
  STAGE_ORDER,
  type ContractDetail,
  type ContractInput,
  type ContractStage,
} from "@/api/recordsAnalytics";
import { PeopleField } from "@/components/analytics/parts";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";
import { errorToast } from "@/lib/errors";
import { asText } from "@/lib/text";
import { STALE, queryKeys } from "@/lib/queryKeys";

interface Values {
  title: string;
  customer_id: string;
  owner_id: string[];
  value: number;
  currency: string;
  period: [Dayjs, Dayjs];
  billing: string;
  auto_renew: boolean;
  notice_days: number;
  stage: ContractStage;
  probability: number;
  terms?: string;
  notes?: string;
  churn_reason?: string;
}

/** Customers by name, from the explorer — the same list the customers page reads. */
export function CustomerPicker({
  value,
  onChange,
  initialLabel,
}: {
  value?: string;
  onChange?: (value: string) => void;
  initialLabel?: string | null;
}) {
  const [term, setTerm] = useState("");
  const debounced = useDebouncedValue(term, 250);
  const results = useQuery({
    queryKey: queryKeys.contractCustomerPicker(debounced),
    queryFn: ({ signal }) =>
      explorerApi.query(
        { resource_type: "customer", columns: ["name", "code"], query_text: debounced || undefined, page_size: 20, sort: "name", order: "asc" },
        signal,
      ),
    staleTime: STALE.short,
  });
  const options = (results.data?.items ?? []).map((row) => ({
    value: asText(row.id),
    label: `${asText(row.name)} · ${asText(row.code)}`,
  }));
  if (value && initialLabel && !options.some((option) => option.value === value)) {
    options.unshift({ value, label: initialLabel });
  }
  return (
    <Select
      showSearch
      value={value}
      onChange={onChange}
      filterOption={false}
      onSearch={setTerm}
      options={options}
      loading={results.isFetching}
      placeholder="Search customers…"
      aria-label="Customer"
      data-testid="contract-customer"
    />
  );
}

export function ContractForm({
  open,
  onClose,
  contract,
  defaults,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  contract?: ContractDetail;
  defaults?: Partial<{ customer_id: string; stage: ContractStage }>;
  onSaved?: (saved: ContractDetail) => void;
}) {
  const [form] = Form.useForm<Values>();
  // Fourteen answers in a drawer that closes on a click outside it (§74).
  const { touch, settled, requestClose } = useDiscardGuard({ close: onClose, what: "contract" });
  const { message } = App.useApp();
  const client = useQueryClient();
  const stage = Form.useWatch("stage", form);

  useEffect(() => {
    if (!open) return;
    if (contract) {
      form.setFieldsValue({
        title: contract.title,
        customer_id: contract.customer.id,
        owner_id: contract.owner.id ? [contract.owner.id] : [],
        value: contract.value,
        currency: contract.currency,
        period: [dayjs(contract.start_date), dayjs(contract.end_date)],
        billing: contract.billing,
        auto_renew: contract.auto_renew,
        notice_days: contract.notice_days,
        stage: contract.stage,
        probability: contract.probability,
        terms: contract.terms ?? undefined,
        notes: contract.notes ?? undefined,
        churn_reason: contract.churn_reason ?? undefined,
      });
    } else {
      form.resetFields();
      const start = dayjs().startOf("day");
      form.setFieldsValue({
        currency: "EUR", billing: "ANNUAL", auto_renew: false, notice_days: 60,
        stage: defaults?.stage ?? "UPCOMING", probability: 50, owner_id: [],
        customer_id: defaults?.customer_id, period: [start, start.add(1, "year")],
      });
    }
  }, [open, contract, defaults, form]);

  const save = useMutation({
    mutationFn: (values: Values) => {
      const body: ContractInput = {
        title: values.title,
        customer_id: values.customer_id,
        owner_id: values.owner_id?.[0] ?? null,
        value: values.value,
        currency: values.currency,
        start_date: values.period[0].format("YYYY-MM-DD"),
        end_date: values.period[1].format("YYYY-MM-DD"),
        billing: values.billing,
        auto_renew: values.auto_renew,
        notice_days: values.notice_days,
        stage: values.stage,
        probability: values.probability,
        terms: values.terms || null,
        notes: values.notes || null,
        churn_reason: values.stage === "CHURNED" ? values.churn_reason || null : null,
      };
      if (!body.owner_id) delete body.owner_id;
      return contract
        ? contractsApi.update(contract.id, { ...body, expected_updated_at: contract.updated_at })
        : contractsApi.create(body);
    },
    onSuccess: (saved) => {
      settled();
      void message.success(contract ? `${saved.reference} saved.` : `${saved.reference} created.`);
      void client.invalidateQueries({ queryKey: queryKeys.contracts() });
      void client.invalidateQueries({ queryKey: queryKeys.contract(saved.id) });
      void client.invalidateQueries({ queryKey: queryKeys.recordVersions("contract", saved.id) });
      // A page that moves on to the saved record replaces the overlay's
      // history entry itself; closing first would send "back" after it.
      if (onSaved) onSaved(saved);
      else onClose();
    },
    onError: errorToast(message, { action: "save contracts" }),
  });

  return (
    <Drawer
      open={open}
      onClose={requestClose}
      title={contract ? `Edit ${contract.reference}` : "New contract"}
      width="min(520px, 100vw)"
      rootClassName={URL_OVERLAY}
      forceRender
      extra={
        <Button type="primary" loading={save.isPending} onClick={() => form.submit()} data-testid="contract-save">
          {contract ? "Save" : "Create"}
        </Button>
      }
    >
      <Form form={form} layout="vertical" onValuesChange={touch} onFinish={(values) => save.mutate(values)} requiredMark="optional">
        <Form.Item name="title" label="Title" rules={[{ required: true, message: "A contract needs a title" }]}>
          <Input maxLength={200} placeholder="Platform subscription" data-testid="contract-title" />
        </Form.Item>
        <Form.Item name="customer_id" label="Customer" rules={[{ required: true, message: "Choose the customer" }]}>
          <CustomerPicker initialLabel={contract?.customer.name} />
        </Form.Item>
        <Form.Item name="owner_id" label="Owner" extra="Defaults to you.">
          <PeopleField single label="Owner" />
        </Form.Item>
        <div style={{ display: "flex", gap: 12 }}>
          <Form.Item name="value" label="Value (ARR)" rules={[{ required: true, message: "Enter the annual value" }]} style={{ flex: 1 }}>
            <InputNumber min={0} step={1000} style={{ width: "100%" }} data-testid="contract-value" />
          </Form.Item>
          <Form.Item name="currency" label="Currency" style={{ width: 110 }}>
            <Select options={["EUR", "USD", "GBP"].map((c) => ({ value: c, label: c }))} />
          </Form.Item>
        </div>
        <Form.Item name="period" label="Term" rules={[{ required: true, message: "Choose the start and end" }]}>
          <DatePicker.RangePicker style={{ width: "100%" }} />
        </Form.Item>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Form.Item name="billing" label="Billing" style={{ flex: 1, minWidth: 140 }}>
            <Select options={[{ value: "ANNUAL", label: "Annual" }, { value: "QUARTERLY", label: "Quarterly" }, { value: "MONTHLY", label: "Monthly" }]} />
          </Form.Item>
          <Form.Item name="notice_days" label="Notice (days)" style={{ width: 130 }}>
            <InputNumber min={0} max={365} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="auto_renew" label="Auto-renew" valuePropName="checked">
            <Switch />
          </Form.Item>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <Form.Item name="stage" label="Stage" style={{ flex: 1 }}>
            <Select options={STAGE_ORDER.map((s) => ({ value: s, label: STAGE_LABEL[s] }))} data-testid="contract-stage" />
          </Form.Item>
          <Form.Item name="probability" label="Probability %" style={{ width: 130 }}>
            <InputNumber min={0} max={100} style={{ width: "100%" }} />
          </Form.Item>
        </div>
        {stage === "CHURNED" && (
          <Form.Item name="churn_reason" label="Why it churned">
            <Input maxLength={200} />
          </Form.Item>
        )}
        <Form.Item name="terms" label="Terms">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item name="notes" label="Notes">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}

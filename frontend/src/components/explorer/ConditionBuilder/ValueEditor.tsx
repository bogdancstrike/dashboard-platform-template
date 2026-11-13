import { DatePicker, Input, InputNumber, Select } from "antd";
import dayjs,{ type Dayjs } from "dayjs";

import type { ExplorerField } from "@/api/explorer";
import { asText } from "@/lib/text";

import { MULTI_VALUE, NO_VALUE } from "../conditionTree";
import { BUILDER_TYPE } from "../queryBuilderConfig";

import { DATE_FORMAT, humanise } from "./fieldMeta";

export function ValueEditor({ field, operator, value, onChange }: {
  field?: ExplorerField;
  operator: string;
  value: unknown[];
  onChange: (value: unknown[]) => void;
}) {
  if (!field) {
    return <span className="nx-fd-cb-ctl nx-fd-cb-novalue">Value</span>;
  }
  if (NO_VALUE.has(operator)) {
    return <span className="nx-fd-cb-novalue">no value needed</span>;
  }
  const type = BUILDER_TYPE[field.kind];
  const label = `Value for ${field.label}`;

  if (MULTI_VALUE.has(operator)) {
    const list = (Array.isArray(value[0]) ? value[0] : []) as Array<string | number>;
    const choices = type === "select" ? field.choices : [];
    return (
      <Select
        mode={choices.length ? "multiple" : "tags"}
        variant="borderless"
        className="nx-fd-cb-ctl nx-fd-cb-multi"
        aria-label={label}
        placeholder={choices.length ? "Choose values" : "Type a value, Enter to add"}
        value={list.map(String)}
        onChange={(next: string[]) =>
          onChange([type === "number" ? next.map(Number).filter((n) => !Number.isNaN(n)) : next])
        }
        options={choices.map((choice) => ({ value: choice, label: humanise(choice) }))}
        tokenSeparators={[","]}
      />
    );
  }

  if (operator === "between") {
    if (type === "datetime") {
      const [a, b] = value as [string | null, string | null];
      return (
        <DatePicker.RangePicker
          showTime={{ format: "HH:mm" }}
          format="YYYY-MM-DD HH:mm"
          variant="borderless"
          className="nx-fd-cb-ctl"
          aria-label={label}
          value={[a ? dayjs(a) : null, b ? dayjs(b) : null]}
          onChange={(range) =>
            onChange([range?.[0]?.format(DATE_FORMAT) ?? null, range?.[1]?.format(DATE_FORMAT) ?? null])
          }
        />
      );
    }
    const [a, b] = value as [number | null, number | null];
    return (
      <span className="nx-fd-cb-between">
        <InputNumber variant="borderless" className="nx-fd-cb-ctl nx-fd-cb-num" aria-label={`${label}, from`} value={a} onChange={(next) => onChange([next, b ?? null])} />
        <span className="nx-fd-cb-and">and</span>
        <InputNumber variant="borderless" className="nx-fd-cb-ctl nx-fd-cb-num" aria-label={`${label}, to`} value={b} onChange={(next) => onChange([a ?? null, next])} />
      </span>
    );
  }

  const single = value[0];
  const empty = single === null || single === undefined || single === "";

  if (type === "select") {
    return (
      <Select
        variant="borderless"
        className={`nx-fd-cb-ctl nx-fd-cb-valsel${empty ? " is-empty" : ""}`}
        popupMatchSelectWidth={false}
        showSearch
        aria-label={empty ? `${label}: not chosen` : label}
        placeholder="Choose a value"
        value={empty ? undefined : asText(single)}
        onChange={(next: string) => onChange([next])}
        options={field.choices.map((choice) => ({ value: choice, label: humanise(choice) }))}
        {...(field.choices.length === 0 ? { mode: undefined } : {})}
      />
    );
  }
  if (type === "boolean") {
    return (
      <Select
        variant="borderless"
        className={`nx-fd-cb-ctl nx-fd-cb-valsel${empty ? " is-empty" : ""}`}
        aria-label={label}
        placeholder="Choose a value"
        value={empty ? undefined : asText(single)}
        onChange={(next: string) => onChange([next === "true"])}
        options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]}
      />
    );
  }
  if (type === "number") {
    return (
      <InputNumber
        variant="borderless"
        className="nx-fd-cb-ctl nx-fd-cb-num"
        aria-label={label}
        placeholder="Value"
        value={empty ? null : Number(single)}
        onChange={(next) => onChange([next])}
      />
    );
  }
  if (type === "datetime") {
    return (
      <DatePicker
        showTime={{ format: "HH:mm" }}
        format="YYYY-MM-DD HH:mm"
        variant="borderless"
        className="nx-fd-cb-ctl nx-fd-cb-date"
        aria-label={label}
        value={empty ? null : dayjs(asText(single))}
        onChange={(next: Dayjs | null) => onChange([next ? next.format(DATE_FORMAT) : null])}
      />
    );
  }
  return (
    <label className="nx-fd-cb-ctl nx-fd-cb-text">
      <span aria-hidden="true">“</span>
      <Input
        variant="borderless"
        aria-label={label}
        placeholder="Type a value"
        value={empty ? "" : asText(single)}
        onChange={(event) => onChange([event.target.value])}
      />
      <span aria-hidden="true">”</span>
    </label>
  );
}

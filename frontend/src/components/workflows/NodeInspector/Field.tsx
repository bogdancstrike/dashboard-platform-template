import type { ReactNode } from "react";
import { Input } from "antd";

import { str } from "../graph";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="nx-wf-field">
      <span className="nx-wf-label">{label}</span>
      {children}
    </div>
  );
}

/** A one-line text setting, with the placeholders the wording may use. */
export function TextField({ name, label, data, set, placeholder = "{rule}: {record}" }: {
  name: string;
  label: string;
  data: Record<string, unknown>;
  set: (changes: Record<string, unknown>) => void;
  placeholder?: string;
}) {
  return (
    <Field label={label}>
      <Input aria-label={label} value={str(data[name])} placeholder={placeholder}
        onChange={(event) => set({ [name]: event.target.value })} />
    </Field>
  );
}

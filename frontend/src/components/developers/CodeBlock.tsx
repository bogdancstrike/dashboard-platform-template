import { App as AntApp, Button, Segmented } from "antd";
import { useState } from "react";

import { NxIcon } from "@/components/NxIcon";

/** A block of code with a copy button — and, given several, a language switch. */
export function CodeBlock({
  code,
  languages,
  label = "Code",
  testId,
}: {
  code?: string;
  /** Alternatives keyed by language label; the first is shown first. */
  languages?: Record<string, string>;
  label?: string;
  testId?: string;
}) {
  const { message } = AntApp.useApp();
  const keys = Object.keys(languages ?? {});
  const [chosen, setChosen] = useState(keys[0] ?? "");
  const text = languages ? languages[chosen] ?? "" : code ?? "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      message.success("Copied");
    } catch {
      message.error("The clipboard refused — select the text instead.");
    }
  };

  return (
    <div className="nx-dev-code" data-testid={testId}>
      <div className="nx-dev-code-bar">
        {languages ? (
          <Segmented size="small" aria-label={`${label} language`} value={chosen} onChange={(value) => setChosen(String(value))}
            options={keys.map((key) => ({ value: key, label: key }))} />
        ) : (
          <span className="nx-dev-code-label">{label}</span>
        )}
        <Button size="small" type="text" icon={<NxIcon name="export" size={14} />} onClick={() => void copy()}
          aria-label={`Copy ${label.toLowerCase()}`}>
          Copy
        </Button>
      </div>
      <pre aria-label={label}><code>{text}</code></pre>
    </div>
  );
}

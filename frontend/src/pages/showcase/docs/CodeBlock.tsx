/**
 * Code, highlighted, with one-click copy (§60).
 *
 * The copy confirms itself in place — the button says *Copied* for a moment —
 * because a toast in the corner is somewhere the eye is not, and a copy that
 * silently failed would look exactly like one that worked.
 */
import { CheckOutlined, CopyOutlined } from "@ant-design/icons";
import { App as AntApp, Button, Tooltip } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";

import { highlight } from "./highlight";

/** Writes to the clipboard, falling back to a selection where the API is refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const done = document.execCommand("copy");
      area.remove();
      return done;
    } catch {
      return false;
    }
  }
}

/** A copy button that says it worked. */
export function CopyButton({ text, label = "Copy", size = "small" }: { text: string; label?: string; size?: "small" | "middle" }) {
  const { message } = AntApp.useApp();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <Tooltip title={copied ? "Copied to the clipboard" : `${label} to the clipboard`}>
      <Button
        size={size}
        className={`nx-doc-copy${copied ? " is-copied" : ""}`}
        icon={copied ? <CheckOutlined /> : <CopyOutlined />}
        aria-live="polite"
        onClick={async () => {
          const ok = await copyText(text);
          if (!ok) {
            message.error("The clipboard refused — select the text and copy it instead.");
            return;
          }
          setCopied(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setCopied(false), 1600);
        }}
      >
        {copied ? "Copied" : label}
      </Button>
    </Tooltip>
  );
}

export function CodeBlock({
  code,
  file,
  maxHeight = 460,
  inline = false,
}: {
  code: string;
  file?: string;
  maxHeight?: number;
  /** One line with the copy beside it, for an import. */
  inline?: boolean;
}) {
  const trimmed = code.replace(/\s+$/, "");
  const tokens = useMemo(() => highlight(trimmed), [trimmed]);
  return (
    <div className={`nx-doc-code${inline ? " nx-doc-code--inline" : ""}`}>
      <div className="nx-doc-codebar">
        <span className="nx-doc-codefile">{file ?? "tsx"}</span>
        <CopyButton text={trimmed + "\n"} />
      </div>
      <pre style={{ maxHeight }} tabIndex={0} aria-label={file ? `Source of ${file}` : "Source"}>
        <code>{tokens}</code>
      </pre>
    </div>
  );
}

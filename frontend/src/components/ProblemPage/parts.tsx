import type { ReactNode } from "react";
import { Button, Typography } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";

/**
 * The correlation id, rendered so it can leave the screen.
 *
 * Selectable text *and* a copy button: the id is thirty-two characters of hex
 * and reading it off a screen into a chat window is how it arrives wrong.
 */
export function Reference({ correlationId }: { correlationId: string }) {
  return (
    <div className="nu-problem-ref" data-testid="problem-reference">
      <Typography.Text type="secondary">Reference</Typography.Text>
      <Typography.Text code copyable={{ icon: <CopyOutlined />, tooltips: false }}>
        {correlationId}
      </Typography.Text>
    </div>
  );
}

/** "Back to home", routed inside the shell and a real navigation outside it. */
export function HomeButton({
  standalone,
  type,
}: {
  standalone: boolean;
  type: "default" | "primary";
}) {
  const button = <Button type={type}>Back to home</Button>;
  if (standalone) return <a href="/">{button}</a>;
  return <Link to="/">{button}</Link>;
}

/** The title with its last word in the accent, the design's emphasis. */
export function emphasiseLast(title: string): ReactNode {
  const at = title.lastIndexOf(" ");
  if (at < 0) return title;
  return (
    <>
      {title.slice(0, at + 1)}
      <em className="nx-em">{title.slice(at + 1)}</em>
    </>
  );
}

/** The Nucleus orbit with the problem's code at its centre. */
export function ProblemMark({ code }: { code: string }) {
  const short = code.length > 4 ? (code === "maintenance" ? "503" : "!") : code;
  return (
    <svg className="nx-fd-problem-mark" viewBox="-70 -70 140 140" aria-hidden="true">
      <ellipse rx="62" ry="26" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.45" transform="rotate(-28)" />
      <ellipse rx="62" ry="26" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.45" transform="rotate(62)" />
      <text x="0" y="13" textAnchor="middle" className="nx-fd-problem-code">{short}</text>
    </svg>
  );
}

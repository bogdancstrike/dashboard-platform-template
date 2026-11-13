import type { ReactNode } from "react";
import { Tooltip, Typography } from "antd";

const { Text } = Typography;

/** A labelled value; a hint, when there is one, is the label's tooltip. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const body = (
    <Text strong className="nu-field-label">
      {label}
    </Text>
  );
  return (
    <div>
      {hint ? <Tooltip title={hint}>{body}</Tooltip> : body}
      {children}
    </div>
  );
}


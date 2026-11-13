import type { ReactNode } from "react";
import { Typography } from "antd";

const { Text } = Typography;

export function Field({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={wide ? "nu-action-field nu-action-field--wide" : "nu-action-field"}>
      <Text strong className="nu-field-label">
        {label}
      </Text>
      {children}
    </div>
  );
}

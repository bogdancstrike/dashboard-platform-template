import type { ReactNode } from "react";
import { Typography } from "antd";

const { Text } = Typography;

/** One labelled control with the reason it exists underneath it. */
export function Setting({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="nu-setting">
      <div className="nu-setting-text">
        <Text strong>{label}</Text>
        {hint && (
          <Text type="secondary" className="nu-setting-hint">
            {hint}
          </Text>
        )}
      </div>
      <div className="nu-setting-control">{children}</div>
    </div>
  );
}

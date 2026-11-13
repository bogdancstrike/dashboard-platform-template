import { Typography } from "antd";

/** A labelled control in a record page's side panel. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Typography.Text strong className="nu-field-label">
        {label}
      </Typography.Text>
      {children}
    </div>
  );
}

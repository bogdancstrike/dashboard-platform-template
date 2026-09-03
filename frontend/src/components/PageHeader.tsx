import type { ReactNode } from "react";
import { Button, Space } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";

/**
 * One header for every page: title, one line of context, actions on the right.
 *
 * Uniform on purpose. Eighty screens that each invent their own heading is
 * eighty screens a reader has to re-orient on; the same three slots in the same
 * places means the eye already knows where the actions are.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  tag,
  onBack,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** A status or count that belongs beside the title rather than under it. */
  tag?: ReactNode;
  onBack?: () => void;
}) {
  return (
    <div className="nu-page-header">
      <div className="nu-page-header-titles">
        <h1 className="nu-page-title">
          {onBack && (
            <Button
              type="text"
              shape="circle"
              aria-label="Back"
              className="nu-page-back"
              icon={<ArrowLeftOutlined />}
              onClick={onBack}
            />
          )}
          {title}
          {tag}
        </h1>
        {subtitle && <div className="nu-page-subtitle">{subtitle}</div>}
      </div>
      {actions && (
        <Space className="nu-page-actions" wrap>
          {actions}
        </Space>
      )}
    </div>
  );
}

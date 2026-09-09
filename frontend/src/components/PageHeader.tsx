import type { ReactNode } from "react";
import { Button, Space } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { Link, useLocation } from "react-router-dom";

import { readOrigin } from "@/entities/drilldown";

/**
 * One header for every page: title, one line of context, actions on the right.
 *
 * Uniform on purpose. Eighty screens that each invent their own heading is
 * eighty screens a reader has to re-orient on; the same three slots in the same
 * places means the eye already knows where the actions are.
 *
 * It also carries the **way back from a drill-down** (§44). Any page reached
 * by clicking a number — a KPI tile, a chart segment, a map region, a quality
 * finding — arrives with `?from=` in its address, and this renders the one
 * press that returns to the picture. Here rather than per page because the
 * pages a drill lands on are the six lists, the explorer and the record pages,
 * and eight copies of a back link is seven chances for one to be missing.
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
  // Read from the address rather than passed in: the page a drill lands on
  // does not know it was a drill, and should not have to.
  const origin = readOrigin(useLocation().search);

  return (
    <div className="nu-page-header">
      <div className="nu-page-header-titles">
        {origin && (
          // Above the title, because it is where the reader *was* rather than
          // an action on what they are looking at now.
          <Link className="nu-page-origin" to={origin.to} data-testid="drill-back">
            <ArrowLeftOutlined /> Back to {origin.label}
          </Link>
        )}
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

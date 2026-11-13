/**
 * The search-and-filter row above an admin list, and the glass panel the list
 * sits in.
 *
 * Every admin list page draws the same two things: a `role="search"` bar whose
 * first control is a free-text box that grows, followed by the page's own
 * filters, and a table panel under it. Written out per page they had drifted
 * only in the words, so the shape lives here and the words stay with the page.
 */
import { Input, type InputProps } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import type { HTMLAttributes, ReactNode } from "react";

interface ListBarProps extends HTMLAttributes<HTMLDivElement> {
  /** The free-text box; its placeholder and accessible name are the page's. */
  search?: InputProps & { "aria-label": string };
  children?: ReactNode;
}

export function ListBar({ search, children, className, ...rest }: ListBarProps) {
  return (
    <div className={className ? `nx-ad-bar ${className}` : "nx-ad-bar"} role="search" {...rest}>
      {search && <Input className="nx-ad-grow" allowClear prefix={<SearchOutlined />} {...search} />}
      {children}
    </div>
  );
}

/** The panel a list's table sits in; `className` adds the page's own hook. */
export function ListPanel({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`nu-pane nu-pane--table${className ? ` ${className}` : ""} nx-ad-panel`} {...rest}>
      {children}
    </div>
  );
}

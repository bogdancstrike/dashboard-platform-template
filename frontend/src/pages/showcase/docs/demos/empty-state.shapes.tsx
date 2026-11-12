import { Button } from "antd";
import { InboxOutlined } from "@ant-design/icons";

import { EmptyState, NoResults } from "@/components/EmptyState";

export default function EmptyStateShapes() {
  return (
    <div className="nx-doc-grid">
      {/* Nothing yet: offer the action that makes the first row. */}
      <EmptyState
        icon={<InboxOutlined />}
        title="No tickets yet"
        hint="A ticket is a customer's problem with a deadline attached."
        action={<Button type="primary">New ticket</Button>}
      />
      {/* Nothing matched: a bad question, not an empty system. */}
      <EmptyState title="Nothing matches" hint="Two filters are narrowing this list." action={<Button>Clear filters</Button>} />
      <NoResults filterCount={2} onClear={() => undefined} />
      <EmptyState compact title="Compact — for a card or a table cell" />
    </div>
  );
}

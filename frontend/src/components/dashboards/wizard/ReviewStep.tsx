import { Space, Typography } from "antd";

import type { WidgetKind } from "@/api/dashboards";
import { EdgeTag } from "@/components/EdgeTag";

import { KINDS } from "../kinds";
import type { Details } from "./DetailsStep";

const { Text } = Typography;

/** The last step: what will be made, before it is. */
export function ReviewStep({ details, kinds }: { details: Details; kinds: WidgetKind[] }) {
  return (
    <div data-testid="wizard-review">
      <Text strong>{details.name}</Text>
      {details.description && (
        <Text type="secondary" style={{ display: "block" }}>
          {details.description}
        </Text>
      )}
      <Text type="secondary" style={{ display: "block", marginTop: 4 }}>
        {details.scope === "PRIVATE"
          ? "Only you will see it"
          : details.scope === "PUBLIC"
            ? "Everyone signed in will see it"
            : "Shared with the people you named"}
      </Text>

      {/* The widgets in the order they will be laid out — the thing the
          reader has been choosing and has not yet seen. */}
      <Space size={[6, 6]} wrap className="nu-block">
        {kinds.map((kind, index) => (
          <EdgeTag key={`${kind}-${index}`} color={KINDS[kind].colour}>
            {KINDS[kind].label}
          </EdgeTag>
        ))}
      </Space>
      <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
        {kinds.length} {kinds.length === 1 ? "widget" : "widgets"}, laid out left to right. Nothing
        is filled in yet — each one opens its own settings on the grid.
      </Text>
    </div>
  );
}

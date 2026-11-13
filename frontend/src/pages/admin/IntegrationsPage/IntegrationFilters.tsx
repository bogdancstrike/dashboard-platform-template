import { Card, Segmented, Space, Typography } from "antd";

const { Text } = Typography;

interface Tally {
  key: string;
  count: number;
}

interface IntegrationFiltersProps {
  total: number;
  categories: Tally[];
  states: Tally[];
  category: string;
  onCategory: (category: string | null) => void;
}

/** The category filter, and every state counted beside it. */
export function IntegrationFilters({ total, categories, states, category, onCategory }: IntegrationFiltersProps) {
  return (
    <Card size="small" className="nu-filter-bar">
      <Space wrap size={8} align="center">
        <Segmented
          aria-label="Category"
          value={category || "all"}
          onChange={(next) => onCategory(next === "all" ? null : String(next))}
          options={[
            { value: "all", label: `All (${total})` },
            ...categories
              .filter((item) => item.count > 0)
              .map((item) => ({
                value: item.key,
                label: `${item.key.replace(/_/g, " ").toLowerCase()} (${item.count})`,
              })),
          ]}
        />
        <Text type="secondary" className="nu-int-tally" data-testid="state-tally">
          {states
            .filter((item) => item.count > 0)
            .map((item) => `${item.count} ${item.key.replace(/_/g, " ").toLowerCase()}`)
            .join(" · ")}
        </Text>
      </Space>
    </Card>
  );
}

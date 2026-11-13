import { Card, Select, Space, Typography } from "antd";
import { ColumnHeightOutlined, HomeOutlined } from "@ant-design/icons";

import { LANDING_PAGES, landingPath } from "./landing";

import { Setting } from "./Setting";

const { Text } = Typography;


import type { SectionProps } from "./sectionProps";

export function DefaultsSection({ preferences, save }: SectionProps) {
  const defaults = preferences.defaults;
  return (
    <Card
      size="small"
      title={
        <Space>
          <ColumnHeightOutlined />
          <span>Defaults</span>
        </Space>
      }
      data-testid="pref-defaults"
      id="pref-defaults"
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Setting
          label="Rows per page"
          hint="Every list opens at this size until you change it there."
        >
          <Select
            aria-label="Rows per page"
            style={{ width: 140 }}
            value={defaults.page_size}
            onChange={(value: 10 | 25 | 50 | 100) => save({ defaults: { page_size: value } })}
            options={[10, 25, 50, 100].map((size) => ({ value: size, label: `${size} rows` }))}
          />
        </Setting>

        <Setting
          label="Home page"
          hint="Where the logo goes, and what opens when you arrive with no address."
        >
          <Space>
            <Select
              aria-label="Home page"
              style={{ width: 200 }}
              value={defaults.landing_page}
              onChange={(value: string) => save({ defaults: { landing_page: value } })}
              options={LANDING_PAGES.map((item) => ({
                value: item.value,
                label: item.label,
              }))}
            />
            <Text type="secondary">
              <HomeOutlined /> {landingPath(defaults.landing_page)}
            </Text>
          </Space>
        </Setting>
      </Space>
    </Card>
  );
}

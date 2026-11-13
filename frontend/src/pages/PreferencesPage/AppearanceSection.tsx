import { Card, Segmented, Space, Switch } from "antd";
import { BgColorsOutlined } from "@ant-design/icons";

import { useAppearance } from "@/theme/AppearanceProvider";

import { Setting } from "./Setting";
import type { SectionProps } from "./sectionProps";

export function AppearanceSection({ preferences, save }: SectionProps) {
  const { appearance, density, setAppearance, setDensity } = useAppearance();
  return (
    <Card
      size="small"
      title={
        <Space>
          <BgColorsOutlined />
          <span>Appearance</span>
        </Space>
      }
      data-testid="pref-appearance"
      id="pref-appearance"
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Setting
          label="Theme"
          hint="System follows the operating system, and keeps following it."
        >
          <Segmented
            aria-label="Theme"
            value={appearance}
            onChange={(next) => setAppearance(next as typeof appearance)}
            options={[
              { label: "Light", value: "light" },
              { label: "Dark", value: "dark" },
              { label: "System", value: "system" },
            ]}
          />
        </Setting>

        <Setting
          label="Density"
          hint="Applied to every screen at once — a table at one height under a toolbar at another is worse than no setting."
        >
          <Segmented
            aria-label="Density"
            value={density}
            onChange={(next) => setDensity(next as typeof density)}
            options={[
              { label: "Compact", value: "compact" },
              { label: "Default", value: "middle" },
              { label: "Comfortable", value: "comfortable" },
            ]}
          />
        </Setting>

        <Setting label="Start with the sidebar collapsed" hint="Useful on a narrow screen.">
          <Switch
            aria-label="Start with the sidebar collapsed"
            checked={preferences.appearance.sidebar_collapsed}
            onChange={(checked) => save({ appearance: { sidebar_collapsed: checked } })}
          />
        </Setting>
      </Space>
    </Card>
  );
}

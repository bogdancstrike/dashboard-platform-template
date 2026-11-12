import { Segmented } from "antd";
import { AppstoreOutlined, BarsOutlined } from "@ant-design/icons";

export default function SegmentedIcons() {
  return (
    <div className="nx-doc-row">
      <Segmented
        aria-label="View"
        options={[
          { value: "list", icon: <BarsOutlined />, label: "List" },
          { value: "cards", icon: <AppstoreOutlined />, label: "Cards" },
        ]}
      />
      <Segmented aria-label="Density" size="small" options={["Compact", "Normal", "Relaxed"]} />
      <Segmented aria-label="Quarter" block options={["Q1", "Q2", "Q3", "Q4"]} style={{ minWidth: 260 }} />
    </div>
  );
}

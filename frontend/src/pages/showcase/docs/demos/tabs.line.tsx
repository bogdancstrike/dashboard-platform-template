import { Tabs } from "antd";

export default function TabsLine() {
  return (
    <Tabs
      defaultActiveKey="overview"
      items={[
        { key: "overview", label: "Overview", children: "The default tab strip: an accent ink bar under the chosen tab." },
        { key: "activity", label: "Activity", children: "Use it inside a card, where a pill strip would be too loud." },
        { key: "files", label: "Files", disabled: true, children: null },
      ]}
    />
  );
}

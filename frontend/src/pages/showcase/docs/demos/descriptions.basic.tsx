import { Descriptions } from "antd";

export default function DescriptionsBasic() {
  return (
    <Descriptions
      bordered
      size="small"
      column={{ xs: 1, md: 2 }}
      items={[
        { key: "v", label: "Version", children: "1.0.0" },
        { key: "e", label: "Environment", children: "production" },
        { key: "r", label: "Realm", children: "nucleus" },
        { key: "u", label: "Uptime", children: "12 days" },
      ]}
    />
  );
}

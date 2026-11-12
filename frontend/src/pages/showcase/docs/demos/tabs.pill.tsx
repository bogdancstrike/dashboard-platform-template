import { Tabs } from "antd";

export default function TabsPill() {
  return (
    <Tabs
      className="nx-ad-tabs"
      defaultActiveKey="access"
      items={[
        { key: "access", label: "Access", children: "What this person may do, and where it comes from." },
        { key: "profile", label: "Profile", children: "Name, title, organization." },
        { key: "sessions", label: "Sessions & sign-ins", children: "Where they are signed in." },
        { key: "history", label: "History", children: "Every change, with who made it." },
      ]}
    />
  );
}

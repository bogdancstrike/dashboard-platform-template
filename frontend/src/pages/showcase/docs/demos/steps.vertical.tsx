import { Steps } from "antd";

export default function StepsVertical() {
  return (
    <Steps
      direction="vertical"
      size="small"
      current={2}
      status="error"
      items={[
        { title: "Uploaded", description: "customers-nov.csv · 1,420 rows" },
        { title: "Mapped", description: "7 of 8 columns matched" },
        { title: "Checked", description: "12 rows need you" },
        { title: "Imported" },
      ]}
    />
  );
}

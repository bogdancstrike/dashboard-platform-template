import { Button, Card } from "antd";
import { PlusOutlined } from "@ant-design/icons";

import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";

export default function EmptyPageTemplate() {
  return (
    <div className="nx-ad">
      <PageHeader title="My dashboards" subtitle="Nothing built yet" />
      <Card>
        <EmptyState
          title="No dashboards yet"
          hint="A dashboard is a set of questions you want answered every morning."
          action={<Button type="primary" icon={<PlusOutlined />}>Build your first</Button>}
        />
      </Card>
    </div>
  );
}

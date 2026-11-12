import { Button } from "antd";
import { PlusOutlined } from "@ant-design/icons";

import { PageHeader } from "@/components/PageHeader";

export default function PageHeaderBasic() {
  return (
    <PageHeader
      title={
        <>
          Customer <em>accounts</em>
        </>
      }
      subtitle="1,204 accounts · 18 renewals this month"
      actions={
        <>
          <Button>Import</Button>
          <Button type="primary" icon={<PlusOutlined />}>
            New account
          </Button>
        </>
      }
    />
  );
}

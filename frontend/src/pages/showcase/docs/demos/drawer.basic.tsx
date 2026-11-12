import { Button, Descriptions, Drawer, Space } from "antd";
import { useState } from "react";

export default function DrawerBasic() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open a drawer</Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Nightly ERP sync"
        width={460}
        extra={<Button type="primary">Retry</Button>}
        footer={
          <Space>
            <Button onClick={() => setOpen(false)}>Close</Button>
          </Space>
        }
      >
        <Descriptions
          column={1}
          size="small"
          items={[
            { key: "q", label: "Queue", children: "integrations" },
            { key: "a", label: "Attempts", children: "3 of 5" },
            { key: "e", label: "Last error", children: "Upstream returned 503 after 3 retries" },
          ]}
        />
      </Drawer>
    </>
  );
}

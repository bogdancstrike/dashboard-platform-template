import { Button } from "antd";
import { DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import { useState } from "react";

export default function ButtonStates() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="nx-doc-row">
      <Button type="primary" loading={busy} onClick={() => { setBusy(true); window.setTimeout(() => setBusy(false), 1500); }}>
        {busy ? "Saving…" : "Save (click me)"}
      </Button>
      <Button disabled>Disabled</Button>
      <Button type="primary" disabled>
        Disabled primary
      </Button>
      <Button icon={<DownloadOutlined />}>With an icon</Button>
      <Button shape="circle" icon={<ReloadOutlined />} aria-label="Refresh" />
      <Button block>Block — fills its column</Button>
    </div>
  );
}

import { Button, Input, Modal } from "antd";
import { useState } from "react";

export default function ModalBasic() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="primary" onClick={() => setOpen(true)}>
        Open a modal
      </Button>
      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => setOpen(false)}
        okText="Share"
        title={
          <>
            Share <em>report</em>
          </>
        }
      >
        <label className="nx-doc-col">
          <b>People or groups</b>
          <Input placeholder="Name, email or group" />
        </label>
      </Modal>
    </>
  );
}

import { Button } from "antd";
import { useState } from "react";

import { NameModal } from "@/components/NameModal";

export default function NameModalBasic() {
  const [open, setOpen] = useState(false);
  const [named, setNamed] = useState("");
  return (
    <div className="nx-doc-row">
      <Button onClick={() => setOpen(true)}>New folder…</Button>
      <span className="nx-doc-muted">{named ? `Last name given: ${named}` : "Nothing named yet."}</span>
      <NameModal
        open={open}
        title="New folder"
        label="Folder name"
        placeholder="Contracts"
        onClose={() => setOpen(false)}
        onSubmit={(value) => {
          setNamed(value);
          setOpen(false);
        }}
      />
    </div>
  );
}

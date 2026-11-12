import { Input } from "antd";
import { useState } from "react";

import { NX_ICONS, NxIcon, type NxIconName } from "@/components/NxIcon";
import { copyText } from "../CodeBlock";

export default function IconsGallery() {
  const [term, setTerm] = useState("");
  const [copied, setCopied] = useState("");
  const names = (Object.keys(NX_ICONS) as NxIconName[]).filter((name) => name.includes(term.trim().toLowerCase()));
  return (
    <div className="nx-doc-col">
      <Input allowClear placeholder={`Search ${Object.keys(NX_ICONS).length} icons`} aria-label="Search icons" value={term} onChange={(event) => setTerm(event.target.value)} style={{ maxWidth: 280 }} />
      <div className="nx-doc-icons" role="list">
        {names.map((name) => (
          <button
            key={name}
            type="button"
            role="listitem"
            className={`nx-doc-icon${copied === name ? " is-copied" : ""}`}
            title={`Copy <NxIcon name="${name}" />`}
            onClick={async () => {
              if (await copyText(`<NxIcon name="${name}" />`)) {
                setCopied(name);
                window.setTimeout(() => setCopied((current) => (current === name ? "" : current)), 1400);
              }
            }}
          >
            <NxIcon name={name} size={20} />
            <span>{copied === name ? "Copied" : name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

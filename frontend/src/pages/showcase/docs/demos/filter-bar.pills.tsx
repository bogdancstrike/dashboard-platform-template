import { Input, Select } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useState } from "react";

const CHIPS = [
  { key: "", label: "All", count: 150, dot: "" },
  { key: "ACTIVE", label: "Active", count: 123, dot: "ok" },
  { key: "INVITED", label: "Invited", count: 11, dot: "acc" },
  { key: "SUSPENDED", label: "Suspended", count: 6, dot: "warn" },
];

export default function FilterBarPills() {
  const [status, setStatus] = useState("");
  const [role, setRole] = useState<string>();
  return (
    <div className="nx-ad nx-doc-flat">
      <div className="nx-ad-bar" role="search">
        <Input className="nx-ad-grow" allowClear prefix={<SearchOutlined />} placeholder="Search people by name or email" aria-label="Search people" />
        <Select
          aria-label="Role"
          placeholder="Role: any"
          allowClear
          className={role ? "nx-ad-set" : undefined}
          value={role}
          onChange={setRole}
          style={{ minWidth: 150 }}
          options={["Manager", "Operator", "Viewer"].map((value) => ({ value, label: value }))}
        />
      </div>
      <div className="nx-ad-segs" role="group" aria-label="Quick filters">
        {CHIPS.map((chip) => (
          <button key={chip.label} type="button" className="nx-ad-seg" aria-pressed={status === chip.key} onClick={() => setStatus(chip.key)}>
            <i className={chip.dot ? `nx-ad-dot--${chip.dot}` : undefined} />
            {chip.label}
            <b>{chip.count}</b>
          </button>
        ))}
      </div>
    </div>
  );
}

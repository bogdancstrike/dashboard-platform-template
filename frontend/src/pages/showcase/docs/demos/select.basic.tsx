import { Select } from "antd";

const ROLES = ["Administrator", "Manager", "Operator", "Analyst", "Viewer"].map((value) => ({ value, label: value }));

export default function SelectBasic() {
  return (
    <div className="nx-doc-grid">
      <Select aria-label="Role" placeholder="Role: any" allowClear options={ROLES} />
      <Select aria-label="Roles" mode="multiple" defaultValue={["Manager", "Operator"]} options={ROLES} />
      <Select aria-label="Searchable" showSearch placeholder="Type to search" options={ROLES} />
      <Select aria-label="Loading" loading placeholder="Loading options" />
      <Select aria-label="Disabled" disabled defaultValue="Viewer" options={ROLES} />
      <Select aria-label="With an error" status="error" placeholder="Required" options={ROLES} />
    </div>
  );
}

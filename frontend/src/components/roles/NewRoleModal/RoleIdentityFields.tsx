import { Col, Form, Input, Row, Select, type FormInstance } from "antd";

import type { RoleRow } from "@/api/roles";

import { codeFor } from "./roleCode";

interface RoleIdentityFieldsProps {
  form: FormInstance;
  roles: RoleRow[];
  name: string;
  touchedCode: boolean;
  setTouchedCode: (touched: boolean) => void;
  /** Starting from another role resets any adjusted permissions. */
  onStartFrom: () => void;
}

/** The role's name, the role it starts from, its code (following the name until edited) and its description. */
export function RoleIdentityFields({ form, roles, name, touchedCode, setTouchedCode, onStartFrom }: RoleIdentityFieldsProps) {
  return (
    <>
      <Row gutter={14}>
        <Col xs={24} md={12}>
          <Form.Item
            name="name"
            label="What is this role for?"
            rules={[{ required: true, message: "A role needs a name" }]}
          >
            <Input
              autoFocus
              maxLength={96}
              placeholder="External auditor"
              aria-label="Role name"
              onChange={(event) => {
                // The code follows the name until somebody edits it themselves,
                // and then it stops — a field that keeps overwriting what was
                // typed is a field people fight.
                if (!touchedCode) form.setFieldValue("code", codeFor(event.target.value));
              }}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="like" label="Start from">
            <Select
              allowClear
              aria-label="Start from"
              placeholder="Nothing — an empty role"
              onChange={onStartFrom}
              options={roles.map((role) => ({
                value: role.code,
                label: `${role.name} (copy ${role.permissions.length} permissions)`,
              }))}
            />
          </Form.Item>
        </Col>
      </Row>

      <Form.Item
        name="code"
        label="Its code"
        extra="Letters, digits and underscores. Quoted in the audit trail and never renamed, so it is worth reading before you agree to it."
        rules={[
          { required: true, message: "A role needs a code" },
          {
            pattern: /^[A-Z0-9_]{2,48}$/,
            message: "2 to 48 characters: A–Z, 0–9 and underscores",
          },
        ]}
      >
        <Input
          className="nu-mono"
          aria-label="Role code"
          placeholder={codeFor(name) || "EXTERNAL_AUDITOR"}
          onChange={() => setTouchedCode(true)}
        />
      </Form.Item>

      <Form.Item name="description" label="Anything worth saying about who holds it">
        <Input.TextArea
          rows={2}
          maxLength={500}
          placeholder="Reads the ledger and the audit trail during the annual audit. Writes nothing."
        />
      </Form.Item>
    </>
  );
}

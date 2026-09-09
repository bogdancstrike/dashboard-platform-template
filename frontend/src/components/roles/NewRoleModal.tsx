/**
 * A role of this installation's own (§13, §10).
 *
 * A plain modal, not a wizard: it is one question — *what is this role for,
 * and roughly what may it do* — and the permission matrix behind it is where
 * the tuning happens. Being asked to tick forty checkboxes before the role
 * exists would be the wizard's worst version of itself; a new role arrives
 * with a starting set and the matrix is one click away.
 *
 * Two decisions worth stating.
 *
 * **The code is derived from the name and shown, not asked for.** It is the
 * identifier `_permissions_for` looks up, `REALM_ROLE_MAP` maps Keycloak onto,
 * and an audit row quotes years later — so a reader should see what they are
 * getting, and being asked to invent an upper-case identifier before naming
 * the thing is a question about implementation. It stays editable, because the
 * derived one is occasionally wrong.
 *
 * **The starting permissions are copied from an existing role.** "Like a
 * viewer, plus the audit log" is how people actually describe a new role, and
 * an empty one is a role whose holders can see nothing and who therefore
 * report the platform as broken.
 */

import { useMutation } from "@tanstack/react-query";
import { App as AntApp, Form, Input, Modal, Select, Typography } from "antd";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { rolesApi, type RoleRow } from "@/api/roles";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";

const { Text } = Typography;

interface FormValues {
  name: string;
  code: string;
  description?: string;
  like?: string;
}

/**
 * The code a name produces.
 *
 * Pure and exported: the server validates the same shape (`[A-Z0-9_]{2,48}`),
 * and a preview that suggested something the server refuses would be a form
 * that fails on its own suggestion.
 */
export function codeFor(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export function NewRoleModal({
  open,
  roles,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** The roles in force, to copy a starting set of permissions from. */
  roles: RoleRow[];
  onClose: () => void;
  onCreated: (role: RoleRow) => void;
}) {
  const [form] = Form.useForm<FormValues>();
  const { touch, settled, requestClose } = useDiscardGuard({
    close: () => {
      form.resetFields();
      setTouchedCode(false);
      onClose();
    },
    what: "role",
  });
  const { message } = AntApp.useApp();
  const [touchedCode, setTouchedCode] = useState(false);
  const name = (Form.useWatch("name", form) as string | undefined) ?? "";

  const create = useMutation({
    mutationFn: (values: FormValues) =>
      rolesApi.create({
        code: values.code || codeFor(values.name),
        name: values.name,
        description: values.description,
        permissions:
          roles.find((role) => role.code === values.like)?.permissions ?? [],
      }),
    onSuccess: (role) => {
      settled();
      message.success(`${role.name} exists — tune what it grants in the matrix`);
      form.resetFields();
      setTouchedCode(false);
      onCreated(role);
    },
    onError: (error) =>
      message.error(
        error instanceof ApiError ? error.message : "That role could not be created.",
      ),
  });

  return (
    <Modal
      open={open}
      title="New role"
      okText="Create the role"
      confirmLoading={create.isPending}
      onCancel={requestClose}
      onOk={() => void form.submit()}
      okButtonProps={{ "data-testid": "create-role" }}
    >
      <Form
        form={form}
        layout="vertical"
        onValuesChange={touch}
        requiredMark={false}
        onFinish={(values) => create.mutate(values)}
        data-testid="role-form"
      >
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

        <Form.Item
          name="like"
          label="Start from"
          extra="Its permissions are copied, and you tune them in the matrix. An empty role is one whose holders can see nothing and who report the platform as broken."
        >
          <Select
            allowClear
            aria-label="Start from"
            placeholder="Nothing — an empty role"
            options={roles.map((role) => ({
              value: role.code,
              label: `${role.name} (${role.permissions.length} permissions)`,
            }))}
          />
        </Form.Item>

        <Text type="secondary">
          It is never a built-in role, whichever code you choose: those five are the
          seed&apos;s, and only their permissions can be changed.
        </Text>
      </Form>
    </Modal>
  );
}

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
 * report the platform as broken. When the page hands over the permission
 * catalogue, the copied set is shown grouped by area and can be adjusted
 * before the role exists — "like a viewer, plus the audit log" in one step.
 */
import { useMutation } from "@tanstack/react-query";
import { App as AntApp, Form, Modal, Typography } from "antd";
import { useState } from "react";

import { rolesApi, type PermissionGroup, type RoleRow } from "@/api/roles";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";
import { apiMessageToast } from "@/lib/errors";

import { PermissionPicker } from "./PermissionPicker";
import { RoleIdentityFields } from "./RoleIdentityFields";
import { codeFor } from "./roleCode";

const { Text } = Typography;

interface FormValues {
  name: string;
  code: string;
  description?: string;
  like?: string;
}

export function NewRoleModal({
  open,
  roles,
  groups,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** The roles in force, to copy a starting set of permissions from. */
  roles: RoleRow[];
  /**
   * The permission catalogue, by area. When given, the copied set is shown
   * and can be adjusted before the role is created.
   */
  groups?: PermissionGroup[];
  onClose: () => void;
  onCreated: (role: RoleRow) => void;
}) {
  const [form] = Form.useForm<FormValues>();
  const { touch, settled, requestClose } = useDiscardGuard({
    close: () => {
      form.resetFields();
      setTouchedCode(false);
      setPicked(null);
      onClose();
    },
    what: "role",
  });
  const { message } = AntApp.useApp();
  const [touchedCode, setTouchedCode] = useState(false);
  const name = (Form.useWatch("name", form) as string | undefined) ?? "";
  const like = Form.useWatch("like", form);
  // What the role will grant. `null` until somebody ticks a box: until then
  // it follows whichever role it starts from.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const copied = roles.find((role) => role.code === like);
  const granted = picked ?? new Set(copied?.permissions ?? []);
  const toggle = (codes: string[], on: boolean) => {
    const next = new Set(granted);
    codes.forEach((code) => (on ? next.add(code) : next.delete(code)));
    setPicked(next);
    touch();
  };

  const create = useMutation({
    mutationFn: (values: FormValues) =>
      rolesApi.create({
        code: values.code || codeFor(values.name),
        name: values.name,
        description: values.description,
        permissions: groups
          ? [...granted]
          : (roles.find((role) => role.code === values.like)?.permissions ?? []),
      }),
    onSuccess: (role) => {
      settled();
      message.success(`${role.name} exists — tune what it grants in the matrix`);
      form.resetFields();
      setTouchedCode(false);
      setPicked(null);
      onCreated(role);
    },
    onError: apiMessageToast(message, "That role could not be created."),
  });

  return (
    <Modal
      open={open}
      width={720}
      className="nx-ad-modal"
      title={
        <div className="nx-ad-modal-title">
          <span>
            New <em>role</em>
          </span>
          <small>
            Roles &amp; permissions · {roles.length} {roles.length === 1 ? "role" : "roles"} today
          </small>
        </div>
      }
      okText="Create role"
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
        <RoleIdentityFields
          form={form}
          roles={roles}
          name={name}
          touchedCode={touchedCode}
          setTouchedCode={setTouchedCode}
          onStartFrom={() => setPicked(null)}
        />

        {groups && groups.length > 0 ? (
          <PermissionPicker groups={groups} granted={granted} copiedFrom={picked ? undefined : copied} toggle={toggle} />
        ) : (
          <Text type="secondary">
            Its permissions are copied from the role it starts from, and you tune them in the
            matrix.
          </Text>
        )}

        <Text type="secondary" className="nx-ad-modal-note">
          It is never a built-in role, whichever code you choose: those five are the
          seed&apos;s, and only their permissions can be changed.
        </Text>
      </Form>
    </Modal>
  );
}

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
import { App as AntApp, Checkbox, Col, Form, Input, Modal, Row, Select, Typography } from "antd";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { rolesApi, type PermissionGroup, type RoleRow } from "@/api/roles";
import { NxIcon, type NxIconName } from "@/components/NxIcon";
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
function codeFor(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

/** An icon for a permission area, by the words in its name. */
function groupIcon(name: string): NxIconName {
  const n = name.toLowerCase();
  if (n.includes("record")) return "briefcase";
  if (n.includes("work") || n.includes("task")) return "check";
  if (n.includes("report") || n.includes("analy") || n.includes("dashboard")) return "bars";
  if (n.includes("admin") || n.includes("user") || n.includes("role")) return "shield";
  if (n.includes("system") || n.includes("platform")) return "gear";
  if (n.includes("data")) return "database";
  return "grid";
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
  const everyPermission = (groups ?? []).flatMap((group) => group.permissions);
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
    onError: (error) =>
      message.error(
        error instanceof ApiError ? error.message : "That role could not be created.",
      ),
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
                onChange={() => setPicked(null)}
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

        {groups && groups.length > 0 ? (
          <section className="nx-ad-perms" aria-label="Permissions">
            <header className="nx-ad-perms-head">
              <b>Permissions</b>
              <span>
                {granted.size} of {everyPermission.length} granted
                {copied && !picked ? ` · copied from ${copied.name}` : ""}
              </span>
            </header>
            {groups.map((group) => {
              const codes = group.permissions.map((permission) => permission.code);
              const held = codes.filter((code) => granted.has(code)).length;
              const all = held === codes.length;
              return (
                <div key={group.name} className="nx-ad-permgroup">
                  <div className="nx-ad-permgroup-head">
                    <span className="nx-ad-icon nx-ad-icon--sm" aria-hidden="true">
                      <NxIcon name={groupIcon(group.name)} size={15} />
                    </span>
                    <b>{group.name}</b>
                    <span className="nx-ad-permgroup-count">
                      · {held} of {codes.length}
                    </span>
                    <button
                      type="button"
                      className="nx-ad-linkbtn"
                      onClick={() => toggle(codes, !all)}
                    >
                      {all ? "Clear all" : "Select all"}
                    </button>
                  </div>
                  <div className="nx-ad-permgrid">
                    {group.permissions.map((permission) => (
                      // The words inside the checkbox's own label: wrapped in a
                      // second <label>, the input had no name at all (axe label).
                      <Checkbox
                        key={permission.code}
                        className={`nx-ad-perm${granted.has(permission.code) ? " is-on" : ""}`}
                        checked={granted.has(permission.code)}
                        onChange={(event) => toggle([permission.code], event.target.checked)}
                      >
                        <span className="nx-ad-perm-text">
                          <b>{permission.label}</b>
                          <code>{permission.code}</code>
                        </span>
                      </Checkbox>
                    ))}
                  </div>
                </div>
              );
            })}
          </section>
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

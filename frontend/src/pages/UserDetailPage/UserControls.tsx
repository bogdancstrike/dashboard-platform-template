import { Button, Select } from "antd";
import { IdcardOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";

import type { UserDetail } from "@/api/users";

import type { useUserDetailPage } from "./useUserDetailPage";

type Page = ReturnType<typeof useUserDetailPage>;

/** Role and status, saved on change for a manager; MFA; and their own profile page. */
export function UserControls({ page, user }: { page: Page; user: UserDetail }) {
  const { roles, change } = page;
  return (
    <div className="nx-ad-bar nx-ad-userbar" data-testid="user-controls">
      {user.can_manage ? (
        <>
          <label className="nx-ad-field">
            <span>Role</span>
            <Select
              aria-label="Role"
              value={user.role_code ?? undefined}
              placeholder="No role"
              loading={roles.isLoading}
              disabled={change.isPending}
              options={(roles.data?.items ?? []).map((role) => ({
                value: role.code,
                label: role.name,
              }))}
              onChange={(code: string) => change.mutate({ role_code: code })}
            />
          </label>
          <label className="nx-ad-field">
            <span>Account status</span>
            <Select
              aria-label="Account status"
              value={user.status}
              disabled={change.isPending}
              options={["ACTIVE", "INVITED", "SUSPENDED", "DISABLED"].map((value) => ({
                value,
                label: value,
              }))}
              onChange={(status: string) => change.mutate({ status })}
            />
          </label>
        </>
      ) : (
        <span className="nx-ad-userbar-note">
          {user.role_name ? `${user.role_name} · ` : ""}
          {user.status.toLowerCase()}
        </span>
      )}
      <span className={`nx-ad-mfa${user.mfa_enabled ? " is-on" : ""}`}>
        <SafetyCertificateOutlined /> MFA {user.mfa_enabled ? "on" : "off"}
      </span>
      {/* The person's own page, which is what a colleague sees of them —
          worth one click from the administration screen, because "what
          does this look like to them" is a question this page invites. */}
      <Link to={`/profile/${user.id}`}>
        <Button icon={<IdcardOutlined />} data-testid="open-profile">
          Their profile
        </Button>
      </Link>
      {user.can_manage && (
        <span className="nx-ad-userbar-note nx-ad-userbar-hint">
          Role and status save on change. Both are recorded in History under your name.
        </span>
      )}
    </div>
  );
}

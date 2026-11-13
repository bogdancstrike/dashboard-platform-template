import { useQuery } from "@tanstack/react-query";
import { Alert, Card, Skeleton, Tooltip, Typography } from "antd";
import { SafetyOutlined, TeamOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { formatNumber } from "@/lib/formats";

import type { Profile } from "@/api/profile";
import { securityApi } from "@/api/security";
import { EmptyState } from "@/components/EmptyState";
import { relativeTime } from "@/lib/time";
import { queryKeys } from "@/lib/queryKeys";

const { Text, Paragraph } = Typography;

/* ── Access ───────────────────────────────────────────────────────────── */

/** `records.update` → area "records", verb "update". */
function byArea(permissions: string[]): Array<[string, string[]]> {
  const areas = new Map<string, string[]>();
  for (const permission of permissions) {
    const [area = permission, verb = ""] = permission.split(".");
    areas.set(area, [...(areas.get(area) ?? []), verb || permission]);
  }
  return [...areas.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function humanArea(area: string): string {
  const words = area.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function ProfileAccessTab({ profile }: { profile: Profile }) {
  const mine = profile.is_me;
  const security = useQuery({
    queryKey: queryKeys.security("overview"),
    queryFn: ({ signal }) => securityApi.overview(signal),
    enabled: mine,
  });

  if (!profile.access) {
    return (
      <EmptyState
        title="Their access is not shown"
        hint="The permission breakdown needs the users.view permission."
      />
    );
  }

  const { access, groups } = profile;
  const viaGroup = new Set(access.from_groups_only);
  return (
    <div className="nu-profile-access nx-fd-paccess" data-testid="profile-access">
      <Card
        size="small"
        className="nx-fd-pcard"
        title={`${profile.role.name || "No role"} — ${formatNumber(access.effective.length)} permissions in effect`}
      >
        {profile.role.description && <Paragraph type="secondary">{profile.role.description}</Paragraph>}
        <dl className="nx-fd-areas">
          {byArea(access.effective).map(([area, verbs]) => (
            <div key={area}>
              <dt>{humanArea(area)}</dt>
              <dd>
                {verbs.map((verb) => {
                  const full = `${area}.${verb}`;
                  const fromGroup = viaGroup.has(full);
                  return (
                    <Tooltip key={verb} title={`${full} — ${fromGroup ? "granted by a group rather than by the role" : "granted by the role"}`}>
                      <span className={`nx-fd-pill${fromGroup ? " nx-fd-pill--acc" : ""}`}>{verb}</span>
                    </Tooltip>
                  );
                })}
              </dd>
            </div>
          ))}
        </dl>
        {access.from_groups_only.length > 0 && (
          <Alert
            type="info"
            showIcon
            data-testid="profile-from-groups"
            message={`${formatNumber(access.from_groups_only.length)} of these come from a group, not the role`}
            description={access.from_groups_only.join(", ")}
          />
        )}
      </Card>

      <div className="nx-fd-pgrid">
        <Card size="small" className="nx-fd-pcard" title="Groups" extra={<TeamOutlined />}>
          {groups.length === 0 ? (
            <EmptyState compact title="Not in any group — everything above comes from the role" />
          ) : (
            <ul className="nu-profile-groups nx-fd-plist">
              {groups.map((group) => (
                <li key={group.id}>
                  <span className="nx-fd-grow">
                    <Text strong>{group.name}</Text> <Text type="secondary">({group.kind})</Text>
                    <span className="nx-fd-chipline">
                      {group.permissions.length === 0 ? (
                        <Text type="secondary">Grants no permissions of its own</Text>
                      ) : (
                        group.permissions.map((permission) => (
                          <span className="nx-fd-pill" key={permission}>{permission}</span>
                        ))
                      )}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {mine && (
          <Card
            size="small"
            className="nx-fd-pcard"
            title="Where you are signed in"
            extra={<Link to="/settings/security"><SafetyOutlined /> Security</Link>}
            data-testid="profile-sessions"
          >
            {security.isLoading ? (
              <Skeleton active paragraph={{ rows: 2 }} />
            ) : security.data ? (
              <dl className="nx-fd-facts">
                <div><dt>Active sessions</dt><dd>{formatNumber(security.data.active_sessions)}</dd></div>
                <div><dt>Other devices</dt><dd>{formatNumber(security.data.other_sessions)}</dd></div>
                <div><dt>Failed sign-ins ({security.data.window_days} days)</dt><dd>{formatNumber(security.data.failed_sign_ins)}</dd></div>
                <div><dt>Unreviewed events</dt><dd>{formatNumber(security.data.unresolved_events)}</dd></div>
                <div>
                  <dt>Last sign-in</dt>
                  <dd>{security.data.last_signed_in_at ? `${relativeTime(security.data.last_signed_in_at)}${security.data.last_signed_in_on ? ` · ${security.data.last_signed_in_on}` : ""}` : "—"}</dd>
                </div>
                <div><dt>Access tokens</dt><dd><Link to="/settings/security">Manage on Security</Link></dd></div>
              </dl>
            ) : (
              <Text type="secondary">Sessions could not be loaded.</Text>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

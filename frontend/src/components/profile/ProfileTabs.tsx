/**
 * The three tabs of a profile, each answering its own question (§41):
 *
 * - **Overview** — who this is and what they hold: where they sit, who they
 *   report to, their groups, and what they did most recently.
 * - **Activity** — what they did, day by day, filterable by kind, with a
 *   per-day strip and the hours they work.
 * - **Access** — what they may do and why: permissions grouped by area, which
 *   of them come from a group rather than the role, the groups themselves,
 *   and (on your own page) where you are signed in.
 */

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Alert, Card, Segmented, Skeleton, Tooltip, Typography } from "antd";
import { SafetyOutlined, TeamOutlined } from "@ant-design/icons";

import type { ActivityEntry, ActivityFeed } from "@/api/activity";
import type { Profile } from "@/api/profile";
import { securityApi } from "@/api/security";
import { EmptyState } from "@/components/EmptyState";
import { formatNumber } from "@/lib/formats";
import { relativeTime } from "@/lib/time";
import { queryKeys } from "@/lib/queryKeys";

const { Text, Paragraph } = Typography;

/* ── Overview ─────────────────────────────────────────────────────────── */

/** Where they sit and how they are set up — the facts the header leaves out. */
export function WhoCard({ profile }: { profile: Profile }) {
  const facts: Array<[string, ReactNode]> = [
    ["Organization", profile.organization?.name ?? "—"],
    ["Department", profile.department?.name ?? "—"],
    ["Team", profile.team?.name ?? "—"],
    [
      "Reports to",
      profile.manager ? <Link to={`/profile/${profile.manager.id}`}>{profile.manager.name}</Link> : "—",
    ],
    ["Sign-ins", profile.login_count === null ? "—" : formatNumber(profile.login_count)],
    ["Two-step verification", profile.mfa_enabled ? "On" : "Off"],
  ];
  return (
    <Card size="small" title="Where they sit" className="nx-fd-pcard" data-testid="profile-who">
      <dl className="nx-fd-facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {profile.groups.length > 0 && (
        <div className="nx-fd-pgroups">
          <span className="nx-fd-eyebrow">Groups</span>
          <div className="nx-fd-chipline">
            {profile.groups.map((group) => (
              <span className="nx-fd-pill" key={group.id}>{group.name}</span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

/** The last few things they did, from the profile payload itself. */
export function Highlights({ profile }: { profile: Profile }) {
  const items = (profile.recent_activity ?? []).slice(0, 6);
  return (
    <Card size="small" title="Recently" className="nx-fd-pcard" data-testid="profile-highlights">
      {!profile.visibility.activity ? (
        <EmptyState compact title="Their recent activity is not shown" />
      ) : items.length === 0 ? (
        <EmptyState compact title="Nothing recorded yet" />
      ) : (
        <ul className="nx-fd-plist">
          {items.map((item) => (
            <li key={item.id}>
              <span className="nx-fd-pdot" aria-hidden="true" />
              <span className="nx-fd-grow">
                <span className="nx-fd-ptext">{item.summary || `${item.action} ${item.resource_label ?? ""}`}</span>
                <span className="nx-fd-muted nx-fd-tiny">{relativeTime(item.occurred_at)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ── Activity ─────────────────────────────────────────────────────────── */

const DAY_MS = 86_400_000;

function dayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayHeading(key: string): string {
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - DAY_MS).toISOString());
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, m! - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

/** Entries per day over the last 14 days, oldest first — the strip above the trail. */
function perDay(items: ActivityEntry[]): Array<{ key: string; label: string; n: number }> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(dayKey(item.occurred_at), (counts.get(dayKey(item.occurred_at)) ?? 0) + 1);
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(Date.now() - (13 - index) * DAY_MS);
    const key = dayKey(date.toISOString());
    return { key, label: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }), n: counts.get(key) ?? 0 };
  });
}

export function ProfileActivityTab({
  profile,
  feed,
  loading,
  kind,
  onKind,
  heatmap,
}: {
  profile: Profile;
  feed: ActivityFeed | undefined;
  loading: boolean;
  kind: string;
  onKind: (kind: string) => void;
  /** "When they work", already built by the page. */
  heatmap: ReactNode;
}) {
  if (!profile.visibility.activity) {
    return (
      <EmptyState
        title="Their activity is not shown"
        hint="A list of everything one person did is the audit log, so it needs the audit.view permission."
      />
    );
  }
  if (loading && !feed) return <Skeleton active paragraph={{ rows: 6 }} />;

  const items = feed?.items ?? [];
  const days = perDay(items);
  const max = Math.max(1, ...days.map((day) => day.n));
  const grouped = new Map<string, ActivityEntry[]>();
  for (const item of items) {
    const key = dayKey(item.occurred_at);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  const kinds = feed?.kinds ?? [];
  const total = kinds.reduce((sum, entry) => sum + entry.count, 0);

  return (
    <div className="nx-fd-pactivity" data-testid="profile-activity">
      <Card size="small" className="nx-fd-pcard" title="The last two weeks">
        <div className="nx-fd-pdays" role="img" aria-label="Actions per day over the last 14 days">
          {days.map((day) => (
            <Tooltip key={day.key} title={`${day.label}: ${day.n}`}>
              <span className="nx-fd-pday">
                <span className="nx-fd-pbar" style={{ height: `${Math.max(4, Math.round((day.n / max) * 100))}%` }} data-empty={day.n === 0} />
              </span>
            </Tooltip>
          ))}
        </div>
        {kinds.length > 0 && (
          <Segmented
            className="nx-fd-kinds"
            aria-label="Kind of activity"
            value={kind || "all"}
            onChange={(next) => onKind(next === "all" ? "" : String(next))}
            options={[
              { value: "all", label: `All (${formatNumber(total)})` },
              ...kinds.map((entry) => ({ value: entry.key, label: `${entry.label} (${formatNumber(entry.count)})` })),
            ]}
          />
        )}
      </Card>

      {items.length === 0 ? (
        <EmptyState title="Nothing recorded yet" hint="Their actions will appear here." />
      ) : (
        <Card size="small" className="nx-fd-pcard nx-fd-ptrail">
          {[...grouped.entries()].map(([key, entries]) => (
            <section key={key} className="nx-fd-pdaygroup" aria-label={dayHeading(key)}>
              <h3 className="nx-fd-eyebrow">{dayHeading(key)} · {entries.length}</h3>
              <ul className="nx-fd-plist">
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <span className="nx-fd-ptime">
                      {new Date(entry.occurred_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    </span>
                    <span className="nx-fd-pill">{entry.kind_label}</span>
                    <span className="nx-fd-grow nx-fd-ptext">
                      {entry.summary || entry.action}
                      {entry.resource_label && entry.resource_path && (
                        <>
                          {" · "}
                          <Link to={entry.resource_path}>{entry.resource_label}</Link>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </Card>
      )}

      {heatmap}
    </div>
  );
}

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

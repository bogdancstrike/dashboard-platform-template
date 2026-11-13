/**
 * A person's own page, and a colleague's (§40, §41).
 *
 * There was nowhere in this platform a reader could look at *themselves*. Their
 * access was visible only to an administrator opening `/admin/users/:id` —
 * which is the page the person asking cannot open — so the commonest support
 * question in any platform of this shape, "why can I not export?", had no
 * self-service answer at all. That question is what the overview leads with.
 *
 * Four decisions worth the reader's attention.
 *
 * **Three tabs, not five.** Overview, Activity, Access. Preferences and
 * security are whole pages already, at `/settings/preferences` and
 * `/settings/security`, and re-hosting either here would put one page at two
 * addresses — two things to keep in step, two axe runs, and a bookmark that
 * points at whichever a reader happened to find. What this page carries instead
 * is a *digest* of each with a way through: "dark, compact, Europe/Bucharest"
 * and "3 devices signed in" are useful at a glance and are not a second copy
 * of the screen that sets them.
 *
 * **The withholding is drawn, not hidden.** A colleague's page shows what the
 * directory shows; the server says which parts it withheld and the page names
 * them, because a panel that is empty for want of permission is
 * indistinguishable from a panel that is broken (§76).
 *
 * **Every number opens the rows behind it** (§44). "18 tasks in hand" that
 * cannot be clicked is a number nobody can check.
 *
 * **The charts are dense.** Every week has a bar and every hour has a cell,
 * because a chart drawn only where there is data reports a quiet week as no
 * week at all — the server sends the empty buckets and this draws them.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Skeleton,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  CalendarOutlined,
  ClockCircleOutlined,
  EditOutlined,
  MailOutlined,
  SafetyOutlined,
  SettingOutlined,
} from "@ant-design/icons";

import type { Profile, ProfileStat } from "@/api/profile";
import { profileApi } from "@/api/profile";
import { activityApi } from "@/api/activity";
import { ChartCard } from "@/components/ChartCard";
import { EmptyState } from "@/components/EmptyState";
import { useSmartBack } from "@/app/history";
import { PageHeader } from "@/components/PageHeader";
import { PersonAvatar } from "@/components/PersonAvatar";
import { StatCard } from "@/components/StatCard";
import { StatusTag } from "@/components/StatusTag";
import { useAuth } from "@/auth/AuthProvider";
import { usePageCommands } from "@/commands/CommandContext";
import { relativeTime } from "@/lib/time";
import { formatDate, formatNumber } from "@/lib/formats";
import { EditProfileDrawer } from "@/components/profile/EditProfileDrawer";
import { Highlights, ProfileAccessTab, ProfileActivityTab, WhoCard } from "@/components/profile/ProfileTabs";
import { queryKeys } from "@/lib/queryKeys";

const { Text, Paragraph } = Typography;

/** Monday first, because that is how every other calendar here is drawn. */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/**
 * The tabs this page has, and the two it deliberately does not.
 *
 * Exported so the test asserts the *decision* rather than the rendering: a
 * fourth tab added here without a panel would be a dead tab, and a Preferences
 * tab added here would be the second copy this page exists to avoid.
 */
export const TABS = ["overview", "activity", "access"] as const;
export type ProfileTab = (typeof TABS)[number];

export function tabFrom(raw: string | null): ProfileTab {
  return (TABS as readonly string[]).includes(raw ?? "") ? (raw as ProfileTab) : "overview";
}

/**
 * The heatmap, in the shape the chart renderer already reads.
 *
 * Hours across, weekdays down. That way round because a working day is read
 * left to right and there are twenty-four of them against seven rows — the
 * transpose is a tall thin chart nobody can label.
 */
export function heatmapPanel(profile: Profile) {
  const hours = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}`);
  return {
    kind: "heatmap" as const,
    title: "When they work",
    groups: hours,
    categories: [...WEEKDAYS],
    series: profile.heatmap.map((cell) => ({
      name: WEEKDAYS[cell.day] ?? "—",
      group: hours[cell.hour] ?? "—",
      value: cell.value,
    })),
  };
}

/** Tasks completed per week — the shape of "am I getting through more". */
export function throughputPanel(profile: Profile) {
  return {
    kind: "bar" as const,
    title: "Tasks completed, by week",
    series: profile.throughput.map((point) => ({
      name: point.bucket.slice(0, 10),
      value: point.value,
    })),
  };
}

/** Which record types somebody spends their time on. */
export function touchesPanel(profile: Profile) {
  return {
    kind: "hbar" as const,
    title: "What they work on",
    series: profile.touches.map((entry) => ({ name: entry.name, value: entry.value })),
  };
}

/** Somebody's own summary line — role, where they sit, when they arrived. */
export function whereTheySit(profile: Profile): string {
  const parts = [
    profile.role.name,
    profile.department?.name,
    profile.organization?.name,
  ].filter(Boolean);
  return parts.join(" · ") || "No role assigned";
}

export default function ProfilePage() {
  const back = useSmartBack();
  const { userId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // The edit drawer lives in the address (`?edit=1`), pushed, so back closes
  // it and a link can open it; × steps back when it was opened from here.
  const location = useLocation();
  const editing = params.get("edit") === "1";
  const setEditing = (open: boolean) => {
    if (open) {
      const next = new URLSearchParams(params);
      next.set("edit", "1");
      setParams(next, { state: { overlay: true } });
    } else if ((location.state as { overlay?: boolean } | null)?.overlay) {
      navigate(-1);
    } else {
      const next = new URLSearchParams(params);
      next.delete("edit");
      setParams(next, { replace: true });
    }
  };
  const auth = useAuth();
  const tab = tabFrom(params.get("tab"));

  const query = useQuery({
    queryKey: queryKeys.profile(userId ?? "me"),
    queryFn: ({ signal }) =>
      userId ? profileApi.person(userId, signal) : profileApi.mine(signal),
  });
  const profile = query.data;

  usePageCommands("profile", [
    {
      id: "profile.preferences",
      label: "Change how the platform looks and behaves",
      keywords: "preferences settings theme density",
      run: () => navigate("/settings/preferences"),
    },
    {
      id: "profile.security",
      label: "Review your sessions and sign-ins",
      keywords: "security sessions devices sign in",
      run: () => navigate("/settings/security"),
    },
    {
      id: "profile.activity",
      label: "See what I have been doing",
      keywords: "activity history feed actions mine recent",
      run: () => navigate("/activity"),
    },
    {
      id: "profile.favorites",
      label: "See what I starred",
      keywords: "favorites bookmarks starred kept recents",
      run: () => navigate("/favorites"),
    },
  ]);

  const activityKind = params.get("kind") ?? "";
  const activity = useQuery({
    queryKey: queryKeys.profileActivity(profile?.user.id, activityKind),
    queryFn: ({ signal }) =>
      activityApi.feed({ actor_id: profile!.user.id, page_size: 100, ...(activityKind ? { kind: activityKind } : {}) }, signal),
    placeholderData: (previous) => previous,
    // Only when the tab is open *and* the reader may see the trail: a request
    // that comes back 403 to fill a tab nobody opened is a 403 in the log for
    // no reason.
    enabled: tab === "activity" && Boolean(profile?.visibility.activity),
  });

  if (query.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;
  if (query.error || !profile) {
    return (
      <EmptyState
        title="That page could not be loaded"
        hint="The person may have been removed, or you may not be allowed to see them."
      />
    );
  }

  const mine = profile.is_me;

  const [firstName, ...restName] = profile.user.full_name.split(" ");

  return (
    <div className="nx-fd-profile">
      <PageHeader
        title={
          restName.length ? (
            <span>
              {firstName} <em>{restName.join(" ")}</em>
            </span>
          ) : (
            profile.user.full_name
          )
        }
        tag={<StatusTag status={profile.user.status} />}
        subtitle={whereTheySit(profile)}
        onBack={userId ? () => back("/admin/users") : undefined}
        actions={
          mine ? (
            <Space size={8} wrap>
              {/* The gap this page had: it *displayed* a job title and a
                  timezone, and the only writer was an administrator on
                  `/admin/users/:id` — the page the person concerned cannot
                  open (§40). */}
              <Button
                type="primary"
                icon={<EditOutlined />}
                onClick={() => setEditing(true)}
                data-testid="edit-profile"
              >
                Edit profile
              </Button>
              <Link to="/settings/preferences">
                <Tag icon={<SettingOutlined />} className="nu-profile-jump">
                  Preferences
                </Tag>
              </Link>
              <Link to="/settings/security">
                <Tag icon={<SafetyOutlined />} className="nu-profile-jump">
                  Security
                </Tag>
              </Link>
            </Space>
          ) : (
            // A colleague's page, and the two things somebody actually wants
            // from one: write to them, and see what they are booked into.
            <Space size={8} wrap>
              {profile.user.email && (
                <Link to={`/mail?compose=${encodeURIComponent(profile.user.email)}`}>
                  <Tag icon={<MailOutlined />} className="nu-profile-jump">
                    Write to them
                  </Tag>
                </Link>
              )}
              <Link to={`/calendar?view=week&person=${profile.user.id}`}>
                <Tag icon={<CalendarOutlined />} className="nu-profile-jump">
                  Their week
                </Tag>
              </Link>
            </Space>
          )
        }
      />

      <Card size="small" className="nu-block nu-profile-card" data-testid="profile-identity">
        <div className="nu-profile-head">
          <PersonAvatar
            name={profile.user.full_name}
            initials={profile.user.initials}
            src={profile.user.avatar_url ?? undefined}
            size={76}
          />
          <div className="nu-profile-facts">
            <Descriptions
              size="small"
              layout="vertical"
              colon={false}
              column={{ xs: 2, sm: 2, md: 3, lg: 4, xl: 4, xxl: 4 }}
              items={[
                { key: "job", label: "Job title", children: profile.user.job_title || "—" },
                {
                  key: "role",
                  label: "Role",
                  children: profile.role.name ? (
                    <Tooltip title={profile.role.description}>
                      <span>{profile.role.name}</span>
                    </Tooltip>
                  ) : (
                    "—"
                  ),
                },
                { key: "team", label: "Team", children: profile.team?.name ?? "—" },
                {
                  key: "email",
                  label: "Email",
                  // Absent rather than blank when withheld, and the page says
                  // so once at the bottom rather than dashing every field.
                  children: profile.user.email ?? <Text type="secondary">Withheld</Text>,
                },
                // The day somebody joined, not the second: "06/27/2023 05:47:56 AM"
                // read as a log line in a person's card.
                { key: "joined", label: "Joined", children: profile.joined_at ? formatDate(new Date(profile.joined_at)) : "—" },
                {
                  key: "zone",
                  label: "Working hours",
                  // Beside the heatmap's subject: "busy at 09:00" means
                  // nothing without knowing whose nine o'clock.
                  children: `${profile.timezone} · ${profile.locale}`,
                },
                {
                  key: "seen",
                  label: "Last sign-in",
                  children: profile.last_login_at
                    ? relativeTime(profile.last_login_at)
                    : "Never signed in",
                },
              ]}
            />
            {!profile.visibility.contact && (
              <Alert
                type="info"
                showIcon
                className="nu-profile-note"
                data-testid="profile-withheld"
                message="Some details are not shown"
                description="Contact details and the permission breakdown need the users.view permission. What is here is what the people directory shows everybody."
              />
            )}
          </div>
        </div>
      </Card>

      <Tabs
        className="nu-profile-tabs"
        activeKey={tab}
        onChange={(key) => {
          const next = new URLSearchParams(params);
          // In the URL, so a tab is linkable and survives a reload (§69).
          if (key === "overview") next.delete("tab");
          else next.set("tab", key);
          next.delete("kind");
          // Pushed, so back returns to the tab you were on.
          setParams(next);
        }}
        items={[
          {
            key: "overview",
            label: "Overview",
            children: <Overview profile={profile} mine={mine} auth={auth} />,
          },
          {
            key: "activity",
            label: "Activity",
            children: (
              <ProfileActivityTab
                profile={profile}
                feed={activity.data}
                loading={activity.isLoading}
                kind={activityKind}
                onKind={(next) => {
                  const search = new URLSearchParams(params);
                  if (next) search.set("kind", next);
                  else search.delete("kind");
                  setParams(search, { replace: true });
                }}
                heatmap={<ProfileHeatmap profile={profile} />}
              />
            ),
          },
          {
            key: "access",
            label: "Access",
            children: <ProfileAccessTab profile={profile} />,
          },
        ]}
      />

      {mine && (
        <EditProfileDrawer
          open={editing}
          profile={auth.profile ?? undefined}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

/** The numbers, the charts, and the two digests. */
function Overview({
  profile,
  mine,
  auth,
}: {
  profile: Profile;
  mine: boolean;
  auth: ReturnType<typeof useAuth>;
}) {
  const throughput = useMemo(() => throughputPanel(profile), [profile]);
  const touches = useMemo(() => touchesPanel(profile), [profile]);

  return (
    <div className="nu-profile-overview">
      <div className="nu-profile-stats" data-testid="profile-stats">
        {profile.stats.map((stat) => (
          <StatLink key={stat.key} stat={stat} />
        ))}
      </div>

      {/* Two columns that end together: who they are (and, on your own
          page, your settings at a glance) beside what they did lately. */}
      <div className="nx-fd-pgrid nx-fd-pgrid--fill">
        <div className="nx-fd-pcol">
          <WhoCard profile={profile} />
          {mine && <MyDigests auth={auth} profile={profile} />}
        </div>
        <Highlights profile={profile} />
      </div>

      <div className="nu-profile-charts">
        <ChartCard id="profile-throughput" panel={throughput} height={200} />
        <ChartCard
          id="profile-touches"
          panel={touches}
          height={200}
          empty={{ title: "Nothing recorded against them yet" }}
        />
      </div>



    </div>
  );
}

/** "When they work" — the hours, on the Activity tab. */
function ProfileHeatmap({ profile }: { profile: Profile }) {
  const heatmap = useMemo(() => heatmapPanel(profile), [profile]);
  const quiet = profile.heatmap.every((cell) => cell.value === 0);
  return (
    <ChartCard
        id="profile-heatmap"
        // A grid of 168 zeroes *is* a grid, and a reader cannot tell it from a
        // broken chart — so a wholly quiet person gets the sentence instead.
        panel={quiet ? undefined : heatmap}
        height={220}
        empty={{
          title: "No activity in the last 90 days",
          hint: "The grid appears once there is something to put in it.",
        }}
      />
  );
}

/** One count, opening the rows it counted (§44). */
function StatLink({ stat }: { stat: ProfileStat }) {
  return (
    <Link to={stat.link} className="nu-profile-stat" data-testid={`profile-stat-${stat.key}`}>
      <StatCard
        label={stat.label}
        value={stat.value}
        displayValue={formatNumber(stat.value)}
        hint={stat.hint}
        accent="accent"
      />
    </Link>
  );
}

/**
 * What the two settings pages would say, in a sentence each.
 *
 * A digest and not a copy: the numbers come from the profile payload the page
 * already has, and the button opens the page that owns the change. Embedding
 * either would put one screen at two addresses.
 */
function MyDigests({
  auth,
  profile,
}: {
  auth: ReturnType<typeof useAuth>;
  profile: Profile;
}) {
  const appearance = auth.profile?.preferences.appearance;
  return (
    <div className="nu-profile-digests" data-testid="profile-digests">
      <Card size="small" title="Preferences" extra={<Link to="/settings/preferences">Change</Link>}>
        <Paragraph className="nu-profile-digest">
          {appearance
            ? `${appearance.theme} theme, ${appearance.density} density`
            : "Not loaded"}
          {" · "}
          {profile.timezone} · {profile.locale}
        </Paragraph>
        <Text type="secondary">
          Stored against your account, so another browser opens the same way.
        </Text>
      </Card>
      <Card size="small" title="Security" extra={<Link to="/settings/security">Review</Link>}>
        <Paragraph className="nu-profile-digest">
          <ClockCircleOutlined /> Last sign-in {relativeTime(profile.last_login_at)} ·{" "}
          {formatNumber(profile.login_count ?? 0)} in total
        </Paragraph>
        <Text type="secondary">
          {profile.mfa_enabled
            ? "Two-factor authentication is on."
            : "Two-factor authentication is off in the identity provider."}
        </Text>
      </Card>
    </div>
  );
}



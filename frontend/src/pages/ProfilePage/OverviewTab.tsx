import { useMemo } from "react";
import { Card, Typography } from "antd";
import { ClockCircleOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { relativeTime } from "@/lib/time";

import type { Profile, ProfileStat } from "@/api/profile";
import type { useAuth } from "@/auth/AuthProvider";
import { ChartCard } from "@/components/ChartCard";
import { Highlights, WhoCard } from "@/components/profile/ProfileTabs";
import { StatCard } from "@/components/StatCard";
import { formatNumber } from "@/lib/formats";

import { heatmapPanel, throughputPanel, touchesPanel } from "./profilePanels";

const { Text, Paragraph } = Typography;

/** The numbers, the charts, and the two digests. */
export function OverviewTab({
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
export function ProfileHeatmap({ profile }: { profile: Profile }) {
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

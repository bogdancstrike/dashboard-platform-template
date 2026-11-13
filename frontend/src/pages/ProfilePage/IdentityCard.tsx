import { Alert, Card, Descriptions, Tooltip, Typography } from "antd";

import type { Profile } from "@/api/profile";
import { PersonAvatar } from "@/components/PersonAvatar";
import { formatDate } from "@/lib/formats";
import { relativeTime } from "@/lib/time";

const { Text } = Typography;

/** The person: avatar, job, role, team, contact, when they joined, their hours and last sign-in. */
export function IdentityCard({ profile }: { profile: Profile }) {
  return (
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
  );
}

import { Button, Space, Tag } from "antd";
import { CalendarOutlined, EditOutlined, MailOutlined, SafetyOutlined, SettingOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";

import type { Profile } from "@/api/profile";

/** Your own page: edit, preferences, security. A colleague's: write to them, see their week. */
export function ProfileActions({ profile, onEdit }: { profile: Profile; onEdit: () => void }) {
  return (
    profile.is_me ? (
      <Space size={8} wrap>
        {/* The gap this page had: it *displayed* a job title and a
            timezone, and the only writer was an administrator on
            `/admin/users/:id` — the page the person concerned cannot
            open (§40). */}
        <Button
          type="primary"
          icon={<EditOutlined />}
          onClick={onEdit}
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
  );
}

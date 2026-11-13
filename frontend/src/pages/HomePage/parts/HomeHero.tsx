import { Button, Space, Tag, Tooltip, Typography } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { PersonAvatar } from "@/components/PersonAvatar";
import { PageHeader } from "@/components/PageHeader";

const { Text, Title } = Typography;

import type { HomePageData } from "../useHomePage";
import { dayInAWord, greeting, longDate } from "../homeCopy";

/** The greeting: who is signed in, what day it is, and one sentence about it. */
export function HomeHero({ page }: { page: HomePageData }) {
  const { profile, me, app, settling, waiting, mine } = page;
  return (
    <>
      <PageHeader
        title={
          <span>
            {greeting()}, <em>{me?.first_name || me?.full_name}.</em>
          </span>
        }
        subtitle={
          <>
            {longDate()}
            {!settling &&
              ` · ${
                waiting.length === 0
                  ? "nothing is waiting on you"
                  : `${waiting.reduce((sum, item) => sum + item.count, 0)} things are waiting on you`
              }`}
          </>
        }
      />
      {/* The band that orients somebody: who they are signed in as, what day
          it is, and one sentence about the day. A greeting on its own is
          decoration; a greeting that answers "is today busy" is a landing
          page doing its job. */}
      <header className="nu-hero">
        <div className="nu-hero-who">
          <span className="nx-ov-hero-avatar" aria-hidden="true">
            {me?.avatar_url ? (
              <PersonAvatar size={52} src={me.avatar_url} initials={me.initials} />
            ) : (
              me?.initials
            )}
          </span>
          <div className="nu-hero-words">
            <Title level={3} className="nu-home-greeting">
              {greeting()}, {me?.first_name || me?.full_name}
            </Title>
            <Text type="secondary" className="nu-hero-line">
              {longDate()} · {profile?.role.name} · {app.data?.name ?? "Nucleus"}{" "}
              {app.data?.version ? `v${app.data.version}` : ""}
              {app.data && app.data.environment !== "production" && (
                <Tooltip title="Set by ENVIRONMENT. A demo that looked like production would be a demo somebody trusted.">
                  <Tag className="nu-home-env" bordered={false}>
                    {app.data.environment}
                  </Tag>
                </Tooltip>
              )}
            </Text>
            {/* Held back until the counts have settled, for the same reason
                the strip is: a reassuring sentence that turns out to be wrong
                is worse than a moment with no sentence at all. */}
            {!settling && (
              <Text className="nu-hero-summary" data-testid="home-summary">
                {dayInAWord(waiting, mine.length)}
              </Text>
            )}
          </div>
        </div>

        <Space size={8} wrap>
          <Link to="/settings/preferences">
            <Button>How you like things</Button>
          </Link>
          <Link to="/dashboard">
            <Button type="primary" icon={<ArrowRightOutlined />} iconPosition="end">
              The numbers
            </Button>
          </Link>
        </Space>
      </header>
    </>
  );
}

/**
 * `/admin` — the administration area's own index (§11, §20).
 *
 * Three decisions worth stating.
 *
 * **It is a map, not a dashboard.** The administration area is nine screens
 * that people visit rarely and need to find quickly; what this page owes them
 * is *where things are and what each one is for*. A second set of KPIs here
 * would compete with `/dashboard` and answer nothing an administrator came
 * for.
 *
 * **Only what the reader may open is listed.** Not greyed out, not listed with
 * a padlock — absent. A card that names a screen and refuses to open it is a
 * worse answer than no card, and this page is rendered from the same
 * permission each destination checks, so the two cannot disagree (§76).
 *
 * **Each card carries one live number**, and only where one is cheap and
 * meaningful — how many people, how many settings differ, how many flags are
 * on. Enough to tell somebody whether they need to go and look; not so much
 * that the page becomes a dashboard by accident.
 */

import { useQuery } from "@tanstack/react-query";
import { Skeleton, Space, Tag, Typography } from "antd";
import {
  ApiOutlined,
  AuditOutlined,
  ClusterOutlined,
  ControlOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  HeartOutlined,
  SafetyOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { settingsApi } from "@/api/settings";
import { usersApi } from "@/api/users";
import { useAuth } from "@/auth/AuthProvider";
import { PageHeader } from "@/components/PageHeader";

const { Text, Title } = Typography;

interface Destination {
  to: string;
  title: string;
  what: string;
  icon: ReactNode;
  /** What the destination itself checks for. */
  permission: string;
  /** A live number, when one is cheap and worth knowing before you go. */
  badge?: string;
}

/**
 * The administration area, and what each screen is for.
 *
 * Exported so the test can assert the *rule* — that every card names the
 * permission its destination requires — rather than the list. A card whose
 * permission drifted from its route's would be a card that opens onto a
 * refusal.
 */
export function destinations(counts: {
  people?: number;
  settingsChanged?: number;
  flagsOn?: number;
}): Destination[] {
  return [
    {
      to: "/admin/users",
      title: "People",
      what: "Who has an account, what they hold, and their sign-in history.",
      icon: <UserOutlined />,
      permission: "users.view",
      badge: counts.people ? `${counts.people} people` : undefined,
    },
    {
      to: "/admin/roles",
      title: "Roles & permissions",
      what: "Every permission the code checks for, and which roles grant it.",
      icon: <SafetyOutlined />,
      permission: "roles.manage",
    },
    {
      to: "/admin/groups",
      title: "Groups",
      what: "Sets of people, for sharing and for targeting a rollout.",
      icon: <TeamOutlined />,
      permission: "users.manage",
    },
    {
      to: "/admin/organizations",
      title: "Organizations",
      what: "The tenants, their departments and their teams.",
      icon: <ClusterOutlined />,
      // Matches the route's own gate: reading the structure is directory
      // information, and a card whose permission drifted from its
      // destination's would be a card that opens onto a refusal.
      permission: "users.view",
    },
    {
      to: "/admin/settings",
      title: "System settings",
      what: "Runtime configuration — retention, limits, security.",
      icon: <SettingOutlined />,
      permission: "settings.manage",
      badge: counts.settingsChanged ? `${counts.settingsChanged} changed` : undefined,
    },
    {
      to: "/admin/flags",
      title: "Feature flags",
      what: "What is switched on, for whom, and whether you have it.",
      icon: <ExperimentOutlined />,
      permission: "flags.manage",
      badge: counts.flagsOn ? `${counts.flagsOn} on` : undefined,
    },
    {
      to: "/admin/audit",
      title: "Audit log",
      what: "Who did what, to which record, and what changed.",
      icon: <AuditOutlined />,
      permission: "audit.view",
    },
    {
      to: "/admin/logs",
      title: "System logs",
      what: "Application log lines, by level and by service.",
      icon: <FileTextOutlined />,
      permission: "logs.view",
    },
    {
      to: "/admin/jobs",
      title: "Background jobs",
      what: "What is queued, what failed, and what can be retried.",
      icon: <ControlOutlined />,
      permission: "jobs.view",
    },
    {
      to: "/admin/api",
      title: "API clients",
      what: "Credentials, their scopes, and the calls they have made.",
      icon: <ApiOutlined />,
      permission: "api.manage",
    },
    {
      to: "/admin/health",
      title: "System health",
      what: "Whether each dependency is answering, and how quickly.",
      icon: <HeartOutlined />,
      permission: "health.view",
    },
  ];
}

export default function AdminHomePage() {
  const { profile } = useAuth();
  const can = (permission: string) => profile?.permissions.includes(permission) ?? false;

  // Two cheap counts, each from the endpoint its own page uses — so a number
  // here cannot disagree with the page it sends somebody to.
  const people = useQuery({
    queryKey: ["admin", "users", "count"],
    queryFn: ({ signal }) => usersApi.list({ page: 1, page_size: 1 }, signal),
    enabled: can("users.view"),
    staleTime: 60_000,
  });
  const config = useQuery({
    queryKey: ["admin-settings", "", ""],
    queryFn: ({ signal }) => settingsApi.all({}, signal),
    enabled: can("settings.manage"),
    staleTime: 60_000,
  });
  const flags = useQuery({
    queryKey: ["admin-flags", ""],
    queryFn: ({ signal }) => settingsApi.flags({}, signal),
    enabled: can("flags.manage"),
    staleTime: 60_000,
  });

  if (!profile) return <Skeleton active paragraph={{ rows: 8 }} />;

  const cards = destinations({
    people: people.data?.total,
    settingsChanged: config.data?.changed,
    flagsOn: flags.data?.counts.on,
  }).filter((card) => can(card.permission));

  return (
    <>
      <PageHeader
        title="Administration"
        subtitle="Who may do what, how the platform is configured, and what it has been doing."
        tag={<Tag>{cards.length} areas</Tag>}
      />

      <div className="nu-adminmap" data-testid="admin-map">
        {cards.map((card) => (
          <Link key={card.to} to={card.to} className="nu-adminmap-card" data-testid={`admin-${card.to}`}>
            <Space size={10} align="start">
              <span className="nu-adminmap-icon" aria-hidden="true">
                {card.icon}
              </span>
              <div>
                <Space size={6}>
                  <Title level={5} className="nu-adminmap-title">
                    {card.title}
                  </Title>
                  {card.badge && (
                    <Tag bordered={false} color="blue">
                      {card.badge}
                    </Tag>
                  )}
                </Space>
                <Text type="secondary" className="nu-adminmap-what">
                  {card.what}
                </Text>
              </div>
            </Space>
          </Link>
        ))}
      </div>
    </>
  );
}

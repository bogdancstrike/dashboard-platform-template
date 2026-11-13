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
import { Button, Skeleton } from "antd";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePageCommands } from "@/commands/CommandContext";

import { settingsApi } from "@/api/settings";
import { usersApi } from "@/api/users";
import { useAuth } from "@/auth/AuthProvider";
import { NxIcon } from "@/components/NxIcon";
import { PageHeader } from "@/components/PageHeader";
import { STALE, queryKeys } from "@/lib/queryKeys";

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
      icon: <NxIcon name="user" />,
      permission: "users.view",
      badge: counts.people ? `${counts.people} people` : undefined,
    },
    {
      to: "/admin/roles",
      title: "Roles & permissions",
      what: "Every permission the code checks for, and which roles grant it.",
      icon: <NxIcon name="shield" />,
      permission: "roles.manage",
    },
    {
      to: "/admin/groups",
      title: "Groups",
      what: "Sets of people, for sharing and for targeting a rollout.",
      icon: <NxIcon name="team" />,
      permission: "users.manage",
    },
    {
      to: "/admin/organizations",
      title: "Organizations",
      what: "The tenants, their departments and their teams.",
      icon: <NxIcon name="org" />,
      // Matches the route's own gate: reading the structure is directory
      // information, and a card whose permission drifted from its
      // destination's would be a card that opens onto a refusal.
      permission: "users.view",
    },
    {
      to: "/admin/settings",
      title: "System settings",
      what: "Runtime configuration — retention, limits, security.",
      icon: <NxIcon name="gear" />,
      permission: "settings.manage",
      badge: counts.settingsChanged ? `${counts.settingsChanged} changed` : undefined,
    },
    {
      to: "/admin/flags",
      title: "Feature flags",
      what: "What is switched on, for whom, and whether you have it.",
      icon: <NxIcon name="flask" />,
      permission: "flags.manage",
      badge: counts.flagsOn ? `${counts.flagsOn} on` : undefined,
    },
    {
      to: "/admin/audit",
      title: "Audit log",
      what: "Who did what, to which record, and what changed.",
      icon: <NxIcon name="audit" />,
      permission: "audit.view",
    },
    {
      to: "/admin/logs",
      title: "System logs",
      what: "Application log lines, by level and by service.",
      icon: <NxIcon name="logs" />,
      permission: "logs.view",
    },
    {
      to: "/admin/jobs",
      title: "Background jobs",
      what: "What is queued, what failed, and what can be retried.",
      icon: <NxIcon name="sliders" />,
      permission: "jobs.view",
    },
    {
      to: "/admin/api",
      title: "API clients",
      what: "Credentials, their scopes, and the calls they have made.",
      icon: <NxIcon name="code" />,
      permission: "api.manage",
    },
    {
      to: "/admin/health",
      title: "System health",
      what: "Whether each dependency is answering, and how quickly.",
      icon: <NxIcon name="heart" />,
      permission: "health.view",
    },
  ];
}

export default function AdminHomePage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const can = (permission: string) => profile?.permissions.includes(permission) ?? false;

  // Two cheap counts, each from the endpoint its own page uses — so a number
  // here cannot disagree with the page it sends somebody to.
  const people = useQuery({
    queryKey: queryKeys.admin("users", "count"),
    queryFn: ({ signal }) => usersApi.list({ page: 1, page_size: 1 }, signal),
    enabled: can("users.view"),
    staleTime: STALE.minute,
  });
  const config = useQuery({
    queryKey: queryKeys.adminSettings("", ""),
    queryFn: ({ signal }) => settingsApi.all({}, signal),
    enabled: can("settings.manage"),
    staleTime: STALE.minute,
  });
  const flags = useQuery({
    queryKey: queryKeys.adminFlags(""),
    queryFn: ({ signal }) => settingsApi.flags({}, signal),
    enabled: can("flags.manage"),
    staleTime: STALE.minute,
  });

  /**
   * What this page can do, for the palette (§31).
   *
   * Built from the same `destinations()` the tiles are, filtered by the same
   * permission — so a command here can never open a page the tile beside it
   * refuses. Two lists of administration areas is how one of them goes stale.
   */
  usePageCommands(
    "admin",
    destinations({})
      .filter((card) => can(card.permission))
      .map((card) => ({
        id: `admin.${card.to}`,
        label: `Administer ${card.title.toLowerCase()}`,
        icon: card.icon,
        keywords: `${card.title} ${card.what} admin`,
        run: () => navigate(card.to),
      })),
  );

  if (!profile) return <Skeleton active paragraph={{ rows: 8 }} />;

  const cards = destinations({
    people: people.data?.total,
    settingsChanged: config.data?.changed,
    flagsOn: flags.data?.counts.on,
  }).filter((card) => can(card.permission));

  return (
    <div className="nx-ad nx-ad--home">
      <PageHeader
        title="Administration"
        subtitle="Health, people and access at a glance — only the areas you may open are listed."
        actions={
          can("audit.view") ? (
            <Button icon={<NxIcon name="audit" size={16} />} onClick={() => navigate("/admin/audit")}>
              Audit log
            </Button>
          ) : undefined
        }
      />

      <nav className="nx-ad-map" aria-label="Administration areas" data-testid="admin-map">
        {cards.map((card, index) => (
          <Link
            key={card.to}
            to={card.to}
            className="nx-ad-mapcard"
            style={{ animationDelay: `${index * 40}ms` }}
            data-testid={`admin-${card.to}`}
          >
            <span className="nx-ad-icon" aria-hidden="true">
              {card.icon}
            </span>
            <span className="nx-ad-mapcard-text">
              <span className="nx-ad-mapcard-head">
                <b>{card.title}</b>
                {card.badge && <span className="nx-ad-badge">{card.badge}</span>}
              </span>
              <span className="nx-ad-mapcard-what">{card.what}</span>
            </span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

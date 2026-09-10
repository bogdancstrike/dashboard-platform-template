import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Breadcrumb,
  Button,
  Dropdown,
  Grid,
  Layout,
  Menu,
  Space,
  Tooltip,
  Typography,
} from "antd";
import {
  LogoutOutlined,
  MenuOutlined,
  MoonOutlined,
  QuestionCircleOutlined,
  SafetyOutlined,
  SettingOutlined,
  SunOutlined,
  UserOutlined,
  UserSwitchOutlined,
} from "@ant-design/icons";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useQuery } from "@tanstack/react-query";

import { notificationsApi } from "@/api/notifications";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { PersonAvatar } from "@/components/PersonAvatar";
import { ProblemPage } from "@/components/ProblemPage";
import { AnnouncementBanner } from "@/components/announcements/AnnouncementBanner";
import { useAuth } from "@/auth/AuthProvider";
import { useImpersonation } from "@/auth/ImpersonationProvider";
import { CommandPalette, CommandTrigger } from "@/components/CommandPalette";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { STORAGE_KEYS } from "@/config";
import { usePollInterval } from "@/live/LiveProvider";
import { landingPath } from "@/pages/PreferencesPage";
import { usePreferences } from "@/settings/PreferencesProvider";
import { LOGO } from "@/theme/tokens";
import { useAppearance } from "@/theme/AppearanceProvider";
import { useFeatures, type FeatureKey } from "@/settings/features";
import { NAV_GROUPS, NAV_ITEMS, selectedKeyFor, trailFor } from "./navigation";

const { Header, Sider, Content } = Layout;

/**
 * The application shell (§1): sidebar, header, breadcrumbs, content.
 *
 * Three decisions worth knowing:
 *
 * * **The sidebar collapses itself on a narrow desktop.** 240px of a 1024px
 *   screen is a quarter of the width spent on a menu nobody is reading, and it
 *   is what squeezes a data table into a sideways scroll. Below `lg` it becomes
 *   a drawer instead of a rail.
 * * **The header is a three-track grid** — navigation, search, identity — so
 *   the search box takes the middle and the width. It is the one control people
 *   aim at rather than glance at.
 * * **Navigation is permission-aware.** Items the signed-in role cannot reach
 *   are absent, not disabled: a menu full of dead ends teaches people to
 *   distrust the menu.
 */
export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const screens = Grid.useBreakpoint();
  const { mode, setAppearance, appearance } = useAppearance();
  const auth = useAuth();
  /** Which features are on for this reader, for the menu and the routes (§27). */
  const features = useFeatures();
  const impersonation = useImpersonation();
  const { preferences, save: savePreference } = usePreferences();

  const isMobile = screens.lg === false;
  const roomy = screens.xl === true;

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEYS.sidebarCollapsed) === "true";
    } catch {
      return false;
    }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Collapse on a cramped desktop, and leave it wherever the reader put it
  // afterwards until the window changes class again.
  useEffect(() => {
    if (!isMobile) setCollapsed(!roomy);
  }, [isMobile, roomy]);

  // The stored preference wins once, when the profile arrives (§40). Only
  // once: a reader who expands the sidebar has overridden their own default
  // for this session, and re-collapsing it on the next render would fight them.
  const preferenceApplied = useRef(false);
  useEffect(() => {
    if (preferenceApplied.current || !auth.profile) return;
    preferenceApplied.current = true;
    if (!isMobile && roomy) setCollapsed(auth.profile.preferences.appearance.sidebar_collapsed);
  }, [auth.profile, isMobile, roomy]);

  /**
   * Collapsing the sidebar is a decision, and decisions are preferences (§40).
   *
   * Saved to the account rather than only to this browser, so it follows the
   * reader to a second machine — the same promise theme, density and page size
   * make. Only an *explicit* toggle writes: the responsive collapse above is a
   * consequence of the window being narrow, and storing that would mean
   * resizing a window silently changed a setting.
   */
  const chooseCollapsed = (next: boolean) => {
    setCollapsed(next);
    if (!isMobile && next !== preferences.appearance.sidebar_collapsed) {
      savePreference({ appearance: { sidebar_collapsed: next } });
    }
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, String(collapsed));
    } catch {
      /* storage disabled */
    }
  }, [collapsed]);

  // Close the mobile drawer whenever the route changes — leaving it open over
  // the page somebody just navigated to is the classic drawer bug.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const selected = selectedKeyFor(location.pathname);
  const showLabels = isMobile || !collapsed;

  // The counters navigation items ride on (§1). Only `unread` has an endpoint
  // today; an item naming a counter nothing publishes renders without a badge
  // rather than with a zero, because a permanent "0" beside a menu entry reads
  // as a broken feature rather than as good news.
  const badgePoll = usePollInterval(60_000);
  const counts = useQuery({
    queryKey: ["notifications", "counts"],
    queryFn: ({ signal }) => notificationsApi.counts(signal),
    refetchInterval: badgePoll,
  });
  const counters: Record<string, number | undefined> = { unread: counts.data?.unread };

  const menuItems = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        key: group.key,
        // Collapsed, a group heading is truncated to "OV…" — a word that has
        // lost the letters that made it a word, taking a row of the rail to
        // say nothing. The label is dropped and the group becomes a rule, so
        // the sections are still separated and nothing is half-said.
        label: showLabels ? group.label : "",
        type: "group" as const,
        children: group.items
          .filter((item) => auth.can(item.permission))
          // A feature that is switched off is not in the menu (§27). The route
          // is refused too, a few lines down — a menu that hides a page whose
          // address still works is a menu somebody routes around.
          .filter((item) => !item.flag || features(item.flag as FeatureKey))
          .map((item) => {
            const count = item.badge ? counters[item.badge] : undefined;
            return {
              key: item.key,
              icon: item.icon,
              label: count ? (
                <span className="nu-nav-item">
                  <span>{item.label}</span>
                  <Badge count={count} size="small" overflowCount={99} />
                </span>
              ) : (
                item.label
              ),
              disabled: item.disabled,
            };
          }),
      })).filter((group) => group.children.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auth.can, counts.data?.unread, showLabels, auth.profile?.features],
  );

  const trail = trailFor(location.pathname);
  const activeItem = NAV_ITEMS.find((item) => item.key === selected);
  const forbidden =
    !auth.loading && Boolean(activeItem?.permission) && !auth.can(activeItem?.permission);
  /**
   * A page whose feature is switched off.
   *
   * Said differently from a permission refusal, and the difference matters: a
   * permission is about *you* and a flag is about the platform, so "your role
   * does not include this" would be a lie about the reader. It names the flag,
   * because the person most likely to arrive here by address is the
   * administrator who just turned it off (§34, §76).
   */
  const switchedOff =
    !auth.loading && Boolean(activeItem?.flag) && !features(activeItem?.flag as FeatureKey);

  return (
    <Layout className="nu-shell">
      {isMobile && drawerOpen && (
        <div className="nu-scrim" onClick={() => setDrawerOpen(false)} aria-hidden />
      )}

      <Sider
        className={`nu-sider${isMobile ? " nu-sider--mobile" : ""}${
          isMobile && drawerOpen ? " nu-sider--open" : ""
        }`}
        theme="dark"
        collapsible={!isMobile}
        collapsed={!isMobile && collapsed}
        onCollapse={chooseCollapsed}
        width={248}
        // 56, not 72: the rail holds a 16px icon, and the extra sixteen
        // pixels were pure margin on a control that is already a compromise.
        collapsedWidth={isMobile ? 0 : 56}
      >
        <div className="nu-logo" onClick={() => navigate(landingPath(auth.profile?.preferences.defaults.landing_page))}>
          <svg viewBox="0 0 64 64" width="28" height="28" aria-hidden>
            <g transform="translate(32 32)">
              <ellipse rx="26" ry="11" fill="none" stroke={LOGO.ring} strokeWidth="4" transform="rotate(-28)" />
              <ellipse rx="26" ry="11" fill="none" stroke={LOGO.ring} strokeWidth="4" opacity="0.5" transform="rotate(52)" />
              <circle r="11" fill={LOGO.core} />
              <circle cx="23" cy="-12.2" r="4" fill={LOGO.spark} />
            </g>
          </svg>
          {showLabels && (
            <span>
              <strong>Nucleus</strong>
              <small>Application template</small>
            </span>
          )}
        </div>

        <CommandTrigger collapsed={!isMobile && collapsed} />

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selected]}
          items={menuItems}
          onClick={(event) => navigate(event.key)}
        />
      </Sider>

      <Layout>
        <Header className="nu-header">
          <Space size={8}>
            {isMobile && (
              <Button
                type="text"
                icon={<MenuOutlined />}
                aria-label="Open navigation"
                onClick={() => setDrawerOpen(true)}
              />
            )}
            {!isMobile && (
              <Breadcrumb
                className="nu-breadcrumb"
                items={trail.map((crumb) => ({
                  title: <Link to={crumb.key}>{crumb.label}</Link>,
                }))}
              />
            )}
          </Space>

          <div className="nu-header-spacer" />

          {/* `align="center"` centres the *items*; an inline-level child inside
              one still rides that item's text baseline, which put the profile
              trigger four and a half pixels above the buttons beside it. The
              rest of the fix is in `.nu-header .ant-space-item`. */}
          <Space size={isMobile ? 4 : 8} align="center">
            <NotificationBell />
            {!isMobile && (
              <Tooltip title={mode === "dark" ? "Switch to light" : "Switch to dark"}>
                <Button
                  shape="circle"
                  aria-label="Toggle theme"
                  icon={mode === "dark" ? <SunOutlined /> : <MoonOutlined />}
                  onClick={() => setAppearance(mode === "dark" ? "light" : "dark")}
                />
              </Tooltip>
            )}
            <Tooltip title="Help">
              <Button shape="circle" aria-label="Help" icon={<QuestionCircleOutlined />} />
            </Tooltip>
            <Dropdown
              menu={{
                items: [
                  {
                    key: "who",
                    disabled: true,
                    label: auth.profile
                      ? `${auth.profile.role.name} · ${auth.profile.organization?.name ?? "No organization"}`
                      : auth.loading
                        ? "Loading profile…"
                        : "Profile unavailable",
                  },
                  { type: "divider" },
                  {
                    // First, because it is the page about *you* — the others
                    // change something, this one explains what you are.
                    key: "profile",
                    icon: <UserOutlined />,
                    label: "Your profile",
                    onClick: () => navigate("/profile"),
                  },
                  {
                    key: "preferences",
                    icon: <SettingOutlined />,
                    label: "Preferences",
                    onClick: () => navigate("/settings/preferences"),
                  },
                  {
                    // Here rather than in the navigation, for the reason
                    // Preferences is: it is about *you* rather than about the
                    // platform, and it needs no permission (§41).
                    key: "security",
                    icon: <SafetyOutlined />,
                    label: "Security",
                    onClick: () => navigate("/settings/security"),
                  },
                  ...(isMobile
                    ? [
                        {
                          key: "theme",
                          icon: mode === "dark" ? <SunOutlined /> : <MoonOutlined />,
                          label: mode === "dark" ? "Light theme" : "Dark theme",
                          onClick: () => setAppearance(mode === "dark" ? "light" : "dark"),
                        },
                      ]
                    : []),
                  {
                    key: "appearance",
                    icon: <MoonOutlined />,
                    label: `Appearance: ${appearance}`,
                    onClick: () =>
                      setAppearance(
                        appearance === "light" ? "dark" : appearance === "dark" ? "system" : "light",
                      ),
                  },
                  { type: "divider" },
                  {
                    key: "signout",
                    icon: <LogoutOutlined />,
                    label: "Sign out",
                    onClick: () => void auth.signOut(),
                  },
                ],
              }}
            >
              <button className="nu-user" type="button" aria-label="Open profile menu">
                <PersonAvatar
                  size="small"
                  src={auth.profile?.user.avatar_url}
                  initials={auth.profile?.user.initials}
                  icon={!auth.profile?.user.avatar_url ? <UserOutlined /> : undefined}
                />
                {!isMobile && (
                  <Typography.Text strong>
                    {auth.profile?.user.full_name ?? (auth.loading ? "Signing in…" : "Unavailable")}
                  </Typography.Text>
                )}
              </button>
            </Dropdown>
          </Space>
        </Header>

        {/* Impossible to miss, and impossible to dismiss without leaving:
            an administrator who forgets they are acting as somebody else is
            the failure mode this feature actually has (§12, §76). */}
        {impersonation.target && (
          <div className="nu-impersonation" role="status">
            <UserSwitchOutlined />
            <span>
              You are viewing the platform as{" "}
              <strong>{impersonation.target.full_name}</strong>. Everything you do is
              recorded under both names.
            </span>
            <Button size="small" onClick={impersonation.stop}>
              Return to your own account
            </Button>
          </div>
        )}

        {/* The platform's own voice (§17). Below the impersonation band,
            because who you are acting as outranks what the platform has to
            say. */}
        <AnnouncementBanner />

        <Content className="nu-content">
          <a className="nu-skip-link" href="#nu-main">
            Skip to content
          </a>
          <div id="nu-main">
            {forbidden ? (
              <ProblemPage
                kind="forbidden"
                missing={activeItem?.permission ? [activeItem.permission] : []}
              />
            ) : switchedOff ? (
              // Not "forbidden": a permission is a fact about the reader, and
              // saying their role is the reason when an administrator turned
              // the whole feature off is a lie about them (§27, §76).
              <ProblemPage kind="switched_off" />
            ) : (
              // Every page renders inside the boundary, and the boundary
              // inside the shell: a fault in one page must not take the
              // navigation with it, or the reader's only way out is the
              // browser's reload button (§34). Reset on the location, so
              // walking away from a broken page is enough to leave it.
              <ErrorBoundary resetKey={location.pathname}>
                <Outlet />
              </ErrorBoundary>
            )}
          </div>
        </Content>
      </Layout>

      <CommandPalette />
    </Layout>
  );
}

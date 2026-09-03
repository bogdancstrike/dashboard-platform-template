import { useEffect, useMemo, useState } from "react";
import {
  Avatar,
  Badge,
  Breadcrumb,
  Button,
  Dropdown,
  Grid,
  Layout,
  Menu,
  Result,
  Space,
  Tooltip,
  Typography,
} from "antd";
import {
  BellOutlined,
  LogoutOutlined,
  MenuOutlined,
  MoonOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
  SunOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "@/auth/AuthProvider";
import { CommandPalette, CommandTrigger } from "@/components/CommandPalette";
import { STORAGE_KEYS } from "@/config";
import { useAppearance } from "@/theme/AppearanceProvider";
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

  const menuItems = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        key: group.key,
        label: group.label,
        type: "group" as const,
        children: group.items
          .filter((item) => auth.can(item.permission))
          .map((item) => ({
            key: item.key,
            icon: item.icon,
            label: item.label,
            disabled: item.disabled,
          })),
      })).filter((group) => group.children.length > 0),
    [auth.can],
  );

  const trail = trailFor(location.pathname);
  const activeItem = NAV_ITEMS.find((item) => item.key === selected);
  const forbidden =
    !auth.loading && Boolean(activeItem?.permission) && !auth.can(activeItem?.permission);

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
        onCollapse={setCollapsed}
        width={248}
        collapsedWidth={isMobile ? 0 : 72}
      >
        <div className="nu-logo" onClick={() => navigate("/dashboard")}>
          <svg viewBox="0 0 64 64" width="28" height="28" aria-hidden>
            <g transform="translate(32 32)">
              <ellipse rx="26" ry="11" fill="none" stroke="#8b8bf0" strokeWidth="4" transform="rotate(-28)" />
              <ellipse rx="26" ry="11" fill="none" stroke="#8b8bf0" strokeWidth="4" opacity="0.5" transform="rotate(52)" />
              <circle r="11" fill="#5b5bd6" />
              <circle cx="23" cy="-12.2" r="4" fill="#22d3ee" />
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

          <Space size={isMobile ? 4 : 8}>
            <Tooltip title="Notifications">
              <Badge count={0} size="small">
                <Button shape="circle" aria-label="Notifications" icon={<BellOutlined />} />
              </Badge>
            </Tooltip>
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
                    key: "preferences",
                    icon: <SettingOutlined />,
                    label: "Preferences",
                    onClick: () => navigate("/settings/preferences"),
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
                  ...(auth.profile?.personas.length
                    ? [
                        { type: "divider" as const },
                        {
                          key: "personas",
                          label: "Switch demo persona",
                          children: auth.profile.personas.map((persona) => ({
                            key: `persona-${persona.username}`,
                            label: `${persona.full_name} · ${persona.role.name}`,
                            onClick: () => void auth.switchPersona(persona.username),
                          })),
                        },
                      ]
                    : []),
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
              <span className="nu-user" tabIndex={0}>
                <Avatar
                  size="small"
                  src={auth.profile?.user.avatar_url ?? undefined}
                  icon={!auth.profile?.user.avatar_url ? <UserOutlined /> : undefined}
                >
                  {auth.profile?.user.initials}
                </Avatar>
                {!isMobile && (
                  <Typography.Text strong>
                    {auth.profile?.user.full_name ?? (auth.loading ? "Signing in…" : "Unavailable")}
                  </Typography.Text>
                )}
              </span>
            </Dropdown>
          </Space>
        </Header>

        <Content className="nu-content">
          <a className="nu-skip-link" href="#nu-main">
            Skip to content
          </a>
          <div id="nu-main">
            {forbidden ? (
              <Result
                status="403"
                title="Permission required"
                subTitle={`Your role does not include ${activeItem?.permission}.`}
              />
            ) : (
              <Outlet />
            )}
          </div>
        </Content>
      </Layout>

      <CommandPalette />
    </Layout>
  );
}

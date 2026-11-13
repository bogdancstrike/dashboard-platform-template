import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button, Dropdown, Grid, Segmented, Tooltip } from "antd";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { notificationsApi } from "@/api/notifications";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { PersonAvatar } from "@/components/PersonAvatar";
import { ProblemPage } from "@/components/ProblemPage";
import { AnnouncementBanner } from "@/components/announcements/AnnouncementBanner";
import { useAuth } from "@/auth/AuthProvider";
import { useImpersonation } from "@/auth/ImpersonationProvider";
import { CommandPalette } from "@/components/CommandPalette";
import { useCommands } from "@/commands/CommandContext";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { TimerPill } from "@/components/decisions/TimerPill";
import { NxIcon, NxLogo } from "@/components/NxIcon";
import { CollapseAllToggle } from "@/components/CollapseAllToggle";
import { STORAGE_KEYS } from "@/config";
import { useLive, usePollInterval } from "@/live/LiveProvider";
import { landingPath } from "@/pages/PreferencesPage";
import { usePreferences } from "@/settings/PreferencesProvider";
import { useAppearance } from "@/theme/AppearanceProvider";
import { DENSITY_LABEL, type Density } from "@/theme/tokens";
import { useFeatures, type FeatureKey } from "@/settings/features";
import { PageTour } from "@/app/PageTour";
import { OverlayHistory, useScrollMemory } from "@/app/history";
import { NAV_GROUPS, NAV_ITEMS, selectedKeyFor, trailFor, type NavGroup } from "./navigation";

type Device = "pc" | "tablet" | "phone";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const CLOSED_GROUPS_KEY = "nu.nav.closed";

function readClosedGroups(): string[] {
  try {
    const raw = window.localStorage.getItem(CLOSED_GROUPS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeClosedGroups(value: string[]) {
  try {
    window.localStorage.setItem(CLOSED_GROUPS_KEY, JSON.stringify(value));
  } catch {
    /* storage disabled */
  }
}

/** The bottom tab bar on a phone (design "Nucleus app shell", phone). */
const TABS: { label: string; icon: "home" | "search" | "check" | "inbox"; to: string; owns: string[] }[] = [
  { label: "Home", icon: "home", to: "/home", owns: ["/home", "/dashboard", "/dashboards", "/activity", "/announcements"] },
  { label: "Search", icon: "search", to: "/explore", owns: ["/explore", "/find", "/favorites"] },
  { label: "Work", icon: "check", to: "/tasks", owns: ["/tasks", "/kanban", "/workflows", "/calendar", "/files"] },
  { label: "Inbox", icon: "inbox", to: "/mail", owns: ["/mail", "/notifications"] },
];

/**
 * The application shell (§1), in the glass design.
 *
 * Three layouts from one component, chosen by width rather than by device:
 *
 * * **PC** — a floating glass sidebar beside a floating glass header. The
 *   sidebar folds to an icon rail (the reader's choice, saved to their
 *   account, §40) and the labels fade out as the width eases in.
 * * **Tablet** — a rail of the groups, and the current group's pages as
 *   chips under the header, so two taps reach anything.
 * * **Phone** — a top bar, a bottom tab bar and a "More" sheet holding the
 *   whole navigation.
 *
 * Navigation stays permission- and flag-aware: items the reader cannot reach
 * are absent, not disabled (§1, §27).
 */
export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const screens = Grid.useBreakpoint();
  const { mode, setAppearance, appearance, density, setDensity } = useAppearance();
  const auth = useAuth();
  const features = useFeatures();
  const impersonation = useImpersonation();
  const { preferences, save: savePreference } = usePreferences();
  const { setOpen: openPalette } = useCommands();
  const live = useLive();

  // Before the first measurement every breakpoint is undefined; treat that as
  // the desktop so the first paint is not a phone layout on a laptop.
  const measured = screens.xl !== undefined || screens.md !== undefined;
  const device: Device = !measured || screens.xl ? "pc" : screens.md ? "tablet" : "phone";
  const isPc = device === "pc";
  const isTablet = device === "tablet";
  const isPhone = device === "phone";

  const [folded, setFolded] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEYS.sidebarCollapsed) === "true";
    } catch {
      return false;
    }
  });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [closedGroups, setClosedGroups] = useState<string[]>(readClosedGroups);

  // The stored preference wins once, when the profile arrives (§40).
  const preferenceApplied = useRef(false);
  useEffect(() => {
    if (preferenceApplied.current || !auth.profile) return;
    preferenceApplied.current = true;
    setFolded(auth.profile.preferences.appearance.sidebar_collapsed);
  }, [auth.profile]);

  /** Folding is a decision, and decisions are preferences (§40). */
  const chooseFolded = (next: boolean) => {
    setFolded(next);
    if (next !== preferences.appearance.sidebar_collapsed) {
      savePreference({ appearance: { sidebar_collapsed: next } });
    }
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, String(folded));
    } catch {
      /* storage disabled */
    }
  }, [folded]);

  useEffect(() => {
    setSheetOpen(false);
  }, [location.pathname]);

  const selected = selectedKeyFor(location.pathname);
  const scrollerRef = useRef<HTMLElement>(null);
  useScrollMemory(scrollerRef);

  // Entrance animations belong to *arriving* on a page. After a moment the
  // page is marked settled, so a filter, a tab or a refetch that re-mounts
  // its panels changes the content in place instead of replaying the
  // entrance — which read as the whole page reloading.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    const timer = window.setTimeout(() => setSettled(true), 1400);
    return () => window.clearTimeout(timer);
  }, [location.pathname]);

  const badgePoll = usePollInterval(60_000);
  const counts = useQuery({
    queryKey: ["notifications", "counts"],
    queryFn: ({ signal }) => notificationsApi.counts(signal),
    refetchInterval: badgePoll,
  });
  const counters: Record<string, number | undefined> = {
    unread: counts.data?.unread,
    // The approvals inbox rides on the same poll (Time & decisions).
    pending_approvals: (counts.data as { pending_approvals?: number } | undefined)?.pending_approvals,
    // Unread chat across channels and direct messages (Collaboration).
    chat_unread: (counts.data as { chat_unread?: number } | undefined)?.chat_unread,
  };

  /** The navigation this reader can actually use. */
  const groups: NavGroup[] = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items
          .filter((item) => auth.can(item.permission))
          .filter((item) => !item.flag || features(item.flag as FeatureKey)),
      })).filter((group) => group.items.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auth.can, auth.profile?.features],
  );

  const currentGroup = groups.find((group) => group.items.some((item) => item.key === selected));
  const trail = trailFor(location.pathname);
  const activeItem = NAV_ITEMS.find((item) => item.key === selected);
  const forbidden =
    !auth.loading && Boolean(activeItem?.permission) && !auth.can(activeItem?.permission);
  const switchedOff =
    !auth.loading && Boolean(activeItem?.flag) && !features(activeItem?.flag as FeatureKey);

  // Keep the current item in view when the sidebar first renders.
  const navRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = navRef.current;
    const el = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el && list) list.scrollTop = Math.max(0, el.offsetTop - list.clientHeight / 2);
    // Only on arrival: scrolling on every route change would fight the reader.
  }, [isPc]);

  const toggleGroup = (key: string) => {
    const next = closedGroups.includes(key)
      ? closedGroups.filter((k) => k !== key)
      : [...closedGroups, key];
    setClosedGroups(next);
    writeClosedGroups(next);
  };

  const user = auth.profile?.user;
  const userName = user?.full_name ?? (auth.loading ? "Signing in…" : "Unavailable");
  const userRole = auth.profile?.role.name ?? "";
  const home = landingPath(auth.profile?.preferences.defaults.landing_page);
  const chord = `${isMac ? "⌘" : "Ctrl "}K`;

  const userMenu = {
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
      { type: "divider" as const },
      { key: "profile", icon: <NxIcon name="user" size={16} />, label: "Your profile", onClick: () => navigate("/profile") },
      { key: "preferences", icon: <NxIcon name="sliders" size={16} />, label: "Preferences", onClick: () => navigate("/settings/preferences") },
      { key: "security", icon: <NxIcon name="shield" size={16} />, label: "Security", onClick: () => navigate("/settings/security") },
      {
        key: "appearance",
        icon: <NxIcon name={mode === "dark" ? "sun" : "moon"} size={16} />,
        label: `Appearance: ${appearance}`,
        onClick: () =>
          setAppearance(appearance === "light" ? "dark" : appearance === "dark" ? "system" : "light"),
      },
      {
        key: "density",
        // A control inside the menu rather than a menu item: choosing a
        // density is a comparison, and the reader should see the page change
        // while the three choices are still in front of them (§40).
        label: (
          <div
            className="nx-density"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <small>Density</small>
            <Segmented<Density>
              aria-label="Density"
              size="small"
              value={density}
              onChange={(value) => setDensity(value)}
              options={(["compact", "middle", "comfortable"] as const).map((value) => ({
                value,
                label: DENSITY_LABEL[value],
              }))}
            />
          </div>
        ),
      },
      { type: "divider" as const },
      { key: "signout", icon: <NxIcon name="logout" size={16} />, label: "Sign out", onClick: () => void auth.signOut() },
    ],
  };

  const avatar = (size: number) => (
    <PersonAvatar size={size} src={user?.avatar_url} initials={user?.initials} className="nx-avatar" />
  );

  const crumbs = (
    <nav aria-label="Breadcrumb" className="nx-crumbs">
      <ol>
        {trail.map((crumb, index) => (
          <li key={`${index}:${crumb.key}`}>
            {index > 0 && <NxIcon name="chevronRight" size={12} stroke={2.4} className="nx-crumb-sep" />}
            <Link
              to={crumb.key}
              aria-current={index === trail.length - 1 ? "page" : undefined}
              className={index === trail.length - 1 ? "nx-crumb nx-crumb--last" : "nx-crumb"}
            >
              {crumb.label}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );

  const themeButton = (
    <Tooltip title={mode === "dark" ? "Switch to light" : "Switch to dark"}>
      <button
        type="button"
        className="nx-iconbtn"
        aria-label="Toggle theme"
        onClick={() => setAppearance(mode === "dark" ? "light" : "dark")}
      >
        <NxIcon name={mode === "dark" ? "sun" : "moon"} />
      </button>
    </Tooltip>
  );

  const liveChip = (
    <span className={`nx-live nx-live--${live.status}`} data-testid="live-status">
      <i aria-hidden="true" />
      {live.status === "live" ? "Live" : live.status === "connecting" ? "Connecting" : "Polling · 30 s"}
    </span>
  );

  const allGroupsClosed =
    groups.length > 1 &&
    groups.every((group) => group.key === currentGroup?.key || closedGroups.includes(group.key));
  const setAllGroups = (collapse: boolean) => {
    // Collapsing everything keeps the current page's group open: folding the
    // menu should never hide where the reader is.
    const next = collapse ? groups.map((group) => group.key).filter((key) => key !== currentGroup?.key) : [];
    setClosedGroups(next);
    writeClosedGroups(next);
  };

  const showLabels = !folded;
  const navList = (
    <div className="nx-side-scroll" ref={navRef}>
      {groups.map((group) => {
        const closed = showLabels && closedGroups.includes(group.key);
        return (
          <div key={group.key} className="nx-group" role="group" aria-label={group.label}>
            {/* A menuitem rather than a button: inside role="menu" only menu
                roles are allowed, and axe failed every page on it. */}
            <button
              type="button"
              role="menuitem"
              className="nx-grouphead"
              aria-expanded={!closed}
              onClick={() => toggleGroup(group.key)}
              tabIndex={showLabels ? 0 : -1}
            >
              <span>{group.label}</span>
              <span className="nx-grouphead-meta">
                {closed && group.items.length}
                <NxIcon name="chevronDown" size={12} stroke={2.4} className={closed ? "is-rot" : undefined} />
              </span>
            </button>
            <div className={`nx-group-items${closed ? " is-closed" : ""}`}>
              <div>
                {group.items.map((item) => {
                  const on = item.key === selected;
                  const count = item.badge ? counters[item.badge] : undefined;
                  const link = (
                    <Link
                      key={item.key}
                      to={item.key}
                      role="menuitem"
                      aria-current={on ? "page" : undefined}
                      aria-label={folded ? item.label : undefined}
                      className={`nx-navitem${on ? " is-on" : ""}${item.badge === "failed_jobs" ? " is-bad" : ""}`}
                      tabIndex={closed ? -1 : 0}
                    >
                      {item.icon}
                      <span className="nx-fold-label">{item.label}</span>
                      {count ? <b className="nx-navbadge">{count > 99 ? "99+" : count}</b> : null}
                    </Link>
                  );
                  return folded ? (
                    <Tooltip key={item.key} title={item.label} placement="right">
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const content = forbidden ? (
    <ProblemPage kind="forbidden" missing={activeItem?.permission ? [activeItem.permission] : []} />
  ) : switchedOff ? (
    <ProblemPage kind="switched_off" />
  ) : (
    <ErrorBoundary resetKey={location.pathname}>
      <Outlet />
    </ErrorBoundary>
  );

  return (
    <div
      className={`nx-app nx-app--${device}${folded && isPc ? " nx-app--folded" : ""}`}
      style={{ "--nx-side-w": folded ? "76px" : "248px" } as CSSProperties}
    >
      <a className="nu-skip-link" href="#nu-main">
        Skip to content
      </a>

      {isPc && (
        <nav aria-label="Main" className="nx-side nx-glass">
          <div className="nx-brandrow">
            <Link to={home} className="nx-brand" aria-label="Nucleus home">
              <NxLogo size={30} />
              <span className="nx-fold-label">
                <b>Nucleus</b>
                <small>{auth.profile?.organization?.name ?? "Application template"}</small>
              </span>
            </Link>
            <button
              type="button"
              className="nx-fold"
              aria-label={folded ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!folded}
              onClick={() => chooseFolded(!folded)}
            >
              <NxIcon name="chevronLeft" size={16} stroke={2.2} />
            </button>
          </div>
          <div className="nx-side-search">
            <Tooltip title={folded ? `Search or jump to… (${chord})` : undefined} placement="right">
              <button
                type="button"
                className="nx-omni"
                onClick={() => openPalette(true)}
                aria-label={`Open the command palette (${chord})`}
              >
                <NxIcon name="search" size={16} stroke={2} />
                <span>Search or jump to…</span>
                <kbd>{chord}</kbd>
              </button>
            </Tooltip>
            <CollapseAllToggle allCollapsed={allGroupsClosed} onToggle={setAllGroups} label="groups" />
          </div>
          {/* Held invisible until the profile says which pages this reader
              has: drawn early, the groups re-flowed as permissions and
              feature flags arrived — a 0.11 layout shift on every page load
              (audit A). Invisible content that appears is not a shift. */}
          <div role="menu" aria-label="Pages" className={`nx-side-menu${auth.profile ? "" : " is-pending"}`}>
            {navList}
          </div>
          <PageTour variant="side" />
        </nav>
      )}

      {isTablet && (
        <nav aria-label="Sections" className="nx-rail nx-glass">
          <Link to={home} aria-label="Nucleus home" className="nx-rail-logo">
            <NxLogo size={34} />
          </Link>
          {groups.map((group) => {
            const on = group.key === currentGroup?.key;
            return (
              <Tooltip key={group.key} title={group.label} placement="right">
                <Link
                  to={group.items[0]?.key ?? "/"}
                  aria-label={group.label}
                  aria-current={on ? "true" : undefined}
                  className={`nx-railitem${on ? " is-on" : ""}`}
                >
                  <NxIcon name={group.icon} size={20} />
                </Link>
              </Tooltip>
            );
          })}
          <span className="nx-rail-spacer" />
          <PageTour variant="rail" />
          <Dropdown menu={userMenu} trigger={["click"]} placement="topLeft">
            <button className="nx-rail-me" type="button" aria-label="Open profile menu">
              {avatar(44)}
            </button>
          </Dropdown>
        </nav>
      )}

      <div className="nx-main">
        {isPc && (
          <header className="nx-top nx-glass">
            {crumbs}
            {liveChip}
            {themeButton}
            <TimerPill />
            <NotificationBell />
            <Dropdown menu={userMenu} trigger={["click"]} placement="bottomRight">
              <button className="nx-user" type="button" aria-label="Open profile menu">
                {avatar(34)}
                <span>
                  <b>{userName}</b>
                  <small>{userRole}</small>
                </span>
              </button>
            </Dropdown>
          </header>
        )}

        {isTablet && (
          <>
            <header className="nx-top nx-glass">
              {crumbs}
              <button
                type="button"
                className="nx-iconbtn nx-iconbtn--lg"
                aria-label="Open the command palette"
                onClick={() => openPalette(true)}
              >
                <NxIcon name="search" stroke={2} />
              </button>
              {themeButton}
              <TimerPill />
              <NotificationBell />
            </header>
            {currentGroup && (
              <nav aria-label={currentGroup.label} className="nx-chips">
                {currentGroup.items.map((item) => (
                  <Link
                    key={item.key}
                    to={item.key}
                    aria-current={item.key === selected ? "page" : undefined}
                    className={`nx-chip${item.key === selected ? " is-on" : ""}`}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            )}
          </>
        )}

        {isPhone && (
          <header className="nx-top nx-top--phone nx-glass">
            <Link to={home} aria-label="Nucleus home" className="nx-phone-logo">
              <NxLogo size={28} />
            </Link>
            <span className="nx-phone-title">
              {activeItem?.label ?? trail[trail.length - 1]?.label ?? "Nucleus"}
            </span>
            <TimerPill />
            <button
              type="button"
              className="nx-iconbtn nx-iconbtn--lg"
              aria-label="Open the command palette"
              onClick={() => openPalette(true)}
            >
              <NxIcon name="search" stroke={2} />
            </button>
            <Dropdown menu={userMenu} trigger={["click"]} placement="bottomRight">
              <button className="nx-rail-me" type="button" aria-label="Open profile menu">
                {avatar(44)}
              </button>
            </Dropdown>
          </header>
        )}

        {impersonation.target && (
          <div className="nu-impersonation" role="status">
            <NxIcon name="switchUser" />
            <span>
              You are viewing the platform as <strong>{impersonation.target.full_name}</strong>.
              Everything you do is recorded under both names.
            </span>
            <Button onClick={impersonation.stop}>Return to your own account</Button>
          </div>
        )}

        <AnnouncementBanner />

        <main className={`nx-scroll nu-content${settled ? " nx-settled" : ""}`} id="nu-main" ref={scrollerRef}>
          {content}
        </main>
      </div>

      {isPhone && (
        <nav aria-label="Main" className="nx-tabs nx-glass nx-glass--strong">
          {TABS.map((tab) => {
            const on = tab.owns.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`));
            return (
              <Link
                key={tab.label}
                to={tab.to}
                aria-current={on ? "page" : undefined}
                className={`nx-tab${on ? " is-on" : ""}`}
              >
                <NxIcon name={tab.icon} size={20} />
                {tab.label}
                {tab.label === "Inbox" && counters["unread"] ? (
                  <b className="nx-tabbadge">{counters["unread"]}</b>
                ) : null}
              </Link>
            );
          })}
          <button
            type="button"
            className={`nx-tab${sheetOpen ? " is-on" : ""}`}
            aria-expanded={sheetOpen}
            aria-label="More navigation"
            onClick={() => setSheetOpen(true)}
          >
            <NxIcon name="more" size={20} />
            More
          </button>
        </nav>
      )}

      {isPhone && sheetOpen && (
        <div className="nx-sheet-scrim" onClick={() => setSheetOpen(false)}>
          <div
            className="nx-sheet nx-glass nx-glass--strong"
            role="dialog"
            aria-label="Navigation"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="nx-sheet-head">
              <b>Everything</b>
              <button
                type="button"
                className="nx-iconbtn"
                aria-label="Close navigation"
                onClick={() => setSheetOpen(false)}
              >
                <NxIcon name="close" />
              </button>
            </div>
            {groups.map((group) => (
              <section key={group.key} className="nx-sheet-group">
                <h2>{group.label}</h2>
                <div>
                  {group.items.map((item) => (
                    <Link
                      key={item.key}
                      to={item.key}
                      className={`nx-sheet-item${item.key === selected ? " is-on" : ""}`}
                      aria-current={item.key === selected ? "page" : undefined}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}

      <CommandPalette />
      <OverlayHistory />
    </div>
  );
}

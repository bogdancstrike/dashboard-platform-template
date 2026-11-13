import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { ErrorBoundary } from "@/app/ErrorBoundary";
import { OverlayHistory, useScrollMemory } from "@/app/history";
import { useAuth } from "@/auth/AuthProvider";
import { AnnouncementBanner } from "@/components/announcements/AnnouncementBanner";
import { CommandPalette } from "@/components/CommandPalette";
import { ProblemPage } from "@/components/ProblemPage";
import { landingPath } from "@/pages/PreferencesPage";
import { FEATURES, flagForPath, useFeatureSync, useFeatures, type FeatureKey } from "@/settings/features";

import { NAV_ITEMS, selectedKeyFor, trailFor } from "./navigation";
import { ImpersonationBar } from "./shell/ImpersonationBar";
import { PhoneSheet, PhoneTabs } from "./shell/PhoneNav";
import { ShellHeader } from "./shell/ShellHeader";
import { Sidebar } from "./shell/Sidebar";
import { GroupChips, TabletRail } from "./shell/TabletNav";
import { useFoldedSidebar } from "./shell/useFoldedSidebar";
import { useNavCounters, useNavGroups } from "./shell/useNavGroups";
import { useSettledPage } from "./shell/useSettledPage";
import { useShellDevice } from "./shell/useShellDevice";

/**
 * The application shell (§1), in the glass design.
 *
 * Three layouts from one component, chosen by width rather than by device:
 *
 * * **PC** — a floating glass sidebar beside a floating glass header. The
 *   sidebar folds to an icon rail (the reader's choice, saved to their
 *   account, §40).
 * * **Tablet** — a rail of the groups, and the current group's pages as
 *   chips under the header, so two taps reach anything.
 * * **Phone** — a top bar, a bottom tab bar and a "More" sheet holding the
 *   whole navigation.
 *
 * Navigation stays permission- and flag-aware: items the reader cannot reach
 * are absent, not disabled (§1, §27). The pieces live in `app/shell/`.
 */
export function AppShell() {
  const location = useLocation();
  const auth = useAuth();
  const features = useFeatures();
  // Flag changes reach this tab without a reload (§27).
  useFeatureSync();
  const paletteOn = features(FEATURES.commandPalette);
  const device = useShellDevice();
  const { folded, chooseFolded } = useFoldedSidebar();
  const groups = useNavGroups();
  const counters = useNavCounters();

  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    setSheetOpen(false);
  }, [location.pathname]);

  const scrollerRef = useRef<HTMLElement>(null);
  useScrollMemory(scrollerRef);
  const settled = useSettledPage(location.pathname);

  const selected = selectedKeyFor(location.pathname);
  const currentGroup = groups.find((group) => group.items.some((item) => item.key === selected));
  const trail = trailFor(location.pathname);
  const activeItem = NAV_ITEMS.find((item) => item.key === selected);
  const forbidden =
    !auth.loading && Boolean(activeItem?.permission) && !auth.can(activeItem?.permission);
  // Any route a flag governs — not only menu entries: `/tasks/grid`,
  // `/workflows/:id/canvas` and `/assistant/:id` are reached by address too.
  const routeFlag = flagForPath(location.pathname) ?? (activeItem?.flag as FeatureKey | undefined);
  const switchedOff = !auth.loading && Boolean(routeFlag) && !features(routeFlag as FeatureKey);
  const home = landingPath(auth.profile?.preferences.defaults.landing_page);

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
      className={`nx-app nx-app--${device}${folded && device === "pc" ? " nx-app--folded" : ""}`}
      style={{ "--nx-side-w": folded ? "76px" : "248px" } as CSSProperties}
    >
      <a className="nu-skip-link" href="#nu-main">
        Skip to content
      </a>

      {device === "pc" && (
        <Sidebar
          home={home}
          groups={groups}
          currentGroupKey={currentGroup?.key}
          selected={selected}
          counters={counters}
          folded={folded}
          onFold={chooseFolded}
          paletteOn={paletteOn}
        />
      )}
      {device === "tablet" && <TabletRail home={home} groups={groups} currentGroupKey={currentGroup?.key} />}

      <div className="nx-main">
        <ShellHeader
          device={device}
          trail={trail}
          home={home}
          title={activeItem?.label ?? trail[trail.length - 1]?.label ?? "Nucleus"}
        />
        {device === "tablet" && currentGroup && <GroupChips group={currentGroup} selected={selected} />}
        <ImpersonationBar />
        <AnnouncementBanner />
        <main className={`nx-scroll nu-content${settled ? " nx-settled" : ""}`} id="nu-main" ref={scrollerRef}>
          {content}
        </main>
      </div>

      {device === "phone" && (
        <PhoneTabs counters={counters} sheetOpen={sheetOpen} onOpenSheet={() => setSheetOpen(true)} />
      )}
      {device === "phone" && sheetOpen && (
        <PhoneSheet groups={groups} selected={selected} onClose={() => setSheetOpen(false)} />
      )}

      {paletteOn && <CommandPalette />}
      <OverlayHistory />
    </div>
  );
}

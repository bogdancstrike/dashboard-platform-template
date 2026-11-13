import { useRef, type CSSProperties } from "react";
import { useLocation } from "react-router-dom";

import { OverlayHistory, useScrollMemory } from "@/app/history";
import { useAuth } from "@/auth/AuthProvider";
import { AnnouncementBanner } from "@/components/announcements/AnnouncementBanner";
import { CommandPalette } from "@/components/CommandPalette";
import { landingPath } from "@/pages/PreferencesPage";
import { FEATURES, useFeatureSync, useFeatures } from "@/settings/features";

import { NAV_ITEMS, selectedKeyFor, trailFor } from "./navigation";
import { ImpersonationBar } from "./shell/ImpersonationBar";
import { PhoneNavigation } from "./shell/PhoneNav";
import { ShellContent } from "./shell/ShellContent";
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

  const scrollerRef = useRef<HTMLElement>(null);
  useScrollMemory(scrollerRef);
  const settled = useSettledPage(location.pathname);

  const selected = selectedKeyFor(location.pathname);
  const currentGroup = groups.find((group) => group.items.some((item) => item.key === selected));
  const trail = trailFor(location.pathname);
  const activeItem = NAV_ITEMS.find((item) => item.key === selected);
  const home = landingPath(auth.profile?.preferences.defaults.landing_page);
  const title = activeItem?.label ?? trail[trail.length - 1]?.label ?? "Nucleus";
  const isPc = device === "pc";

  return (
    <div
      className={`nx-app nx-app--${device}${folded && isPc ? " nx-app--folded" : ""}`}
      style={{ "--nx-side-w": folded ? "76px" : "248px" } as CSSProperties}
    >
      <a className="nu-skip-link" href="#nu-main">
        Skip to content
      </a>

      {isPc && (
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
          title={title}
        />
        {device === "tablet" && currentGroup && <GroupChips group={currentGroup} selected={selected} />}
        <ImpersonationBar />
        <AnnouncementBanner />
        <main className={`nx-scroll nu-content${settled ? " nx-settled" : ""}`} id="nu-main" ref={scrollerRef}>
          <ShellContent activeItem={activeItem} />
        </main>
      </div>

      {device === "phone" && <PhoneNavigation groups={groups} selected={selected} counters={counters} />}

      {paletteOn && <CommandPalette />}
      <OverlayHistory />
    </div>
  );
}

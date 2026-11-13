import { Link } from "react-router-dom";

import { useAuth } from "@/auth/AuthProvider";
import { NxLogo } from "@/components/NxIcon";
import { TimerPill } from "@/components/decisions/TimerPill";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { FEATURES, useFeatures } from "@/settings/features";

import { Breadcrumbs, LiveChip, PaletteButton, ThemeButton } from "./HeaderControls";
import { ShellAvatar, UserMenu } from "./UserMenu";
import type { ShellDevice } from "./useShellDevice";

type Trail = { label: string; key: string }[];

interface ShellHeaderProps {
  device: ShellDevice;
  trail: Trail;
  home: string;
  /** The phone's one-line title. */
  title: string;
}

function PcHeader({ trail }: { trail: Trail }) {
  const auth = useAuth();
  const features = useFeatures();
  const userName = auth.profile?.user.full_name ?? (auth.loading ? "Signing in…" : "Unavailable");
  return (
    <header className="nx-top nx-glass">
      <Breadcrumbs trail={trail} />
      {features(FEATURES.liveUpdates) && <LiveChip />}
      {features(FEATURES.darkMode) && <ThemeButton />}
      <TimerPill />
      <NotificationBell />
      <UserMenu placement="bottomRight">
        <button className="nx-user" type="button" aria-label="Open profile menu">
          <ShellAvatar size={34} />
          <span>
            <b>{userName}</b>
            <small>{auth.profile?.role.name ?? ""}</small>
          </span>
        </button>
      </UserMenu>
    </header>
  );
}

function TabletHeader({ trail }: { trail: Trail }) {
  const features = useFeatures();
  return (
    <header className="nx-top nx-glass">
      <Breadcrumbs trail={trail} />
      {features(FEATURES.commandPalette) && <PaletteButton />}
      {features(FEATURES.darkMode) && <ThemeButton />}
      <TimerPill />
      <NotificationBell />
    </header>
  );
}

function PhoneHeader({ home, title }: { home: string; title: string }) {
  const features = useFeatures();
  return (
    <header className="nx-top nx-top--phone nx-glass">
      <Link to={home} aria-label="Nucleus home" className="nx-phone-logo">
        <NxLogo size={28} />
      </Link>
      <span className="nx-phone-title">{title}</span>
      <TimerPill />
      {features(FEATURES.commandPalette) && <PaletteButton />}
      <UserMenu placement="bottomRight">
        <button className="nx-rail-me" type="button" aria-label="Open profile menu">
          <ShellAvatar size={44} />
        </button>
      </UserMenu>
    </header>
  );
}

/** The floating glass header, in the shape the current layout needs. */
export function ShellHeader({ device, trail, home, title }: ShellHeaderProps) {
  if (device === "pc") return <PcHeader trail={trail} />;
  if (device === "tablet") return <TabletHeader trail={trail} />;
  return <PhoneHeader home={home} title={title} />;
}

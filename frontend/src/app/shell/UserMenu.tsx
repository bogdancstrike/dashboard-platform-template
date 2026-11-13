import { useCallback, useState, type ReactNode } from "react";
import { Dropdown, Segmented, type DropdownProps, type MenuProps } from "antd";
import { useNavigate } from "react-router-dom";

import { useAuth } from "@/auth/AuthProvider";
import { NxIcon } from "@/components/NxIcon";
import { PersonAvatar } from "@/components/PersonAvatar";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { FEATURES, useFeatures } from "@/settings/features";
import { useAppearance } from "@/theme/AppearanceProvider";
import { DENSITY_LABEL, type Density } from "@/theme/tokens";

/** The signed-in reader's picture, at the size each layout wants. */
export function ShellAvatar({ size }: { size: number }) {
  const user = useAuth().profile?.user;
  return <PersonAvatar size={size} src={user?.avatar_url} initials={user?.initials} className="nx-avatar" />;
}

/**
 * A control inside the menu rather than a menu item: choosing a density is a
 * comparison, and the reader should see the page change while the three
 * choices are still in front of them (§40).
 */
function DensityChoice() {
  const { density, setDensity } = useAppearance();
  return (
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
  );
}

function useUserMenuItems(): MenuProps["items"] {
  const navigate = useNavigate();
  const auth = useAuth();
  const features = useFeatures();
  const { mode, setAppearance, appearance } = useAppearance();
  const who = auth.profile
    ? `${auth.profile.role.name} · ${auth.profile.organization?.name ?? "No organization"}`
    : auth.loading
      ? "Loading profile…"
      : "Profile unavailable";
  return [
    { key: "who", disabled: true, label: who },
    { type: "divider" as const },
    { key: "profile", icon: <NxIcon name="user" size={16} />, label: "Your profile", onClick: () => navigate("/profile") },
    { key: "preferences", icon: <NxIcon name="sliders" size={16} />, label: "Preferences", onClick: () => navigate("/settings/preferences") },
    { key: "security", icon: <NxIcon name="shield" size={16} />, label: "Security", onClick: () => navigate("/settings/security") },
    features(FEATURES.darkMode) && {
      key: "appearance",
      icon: <NxIcon name={mode === "dark" ? "sun" : "moon"} size={16} />,
      label: `Appearance: ${appearance}`,
      onClick: () =>
        setAppearance(appearance === "light" ? "dark" : appearance === "dark" ? "system" : "light"),
    },
    { key: "density", label: <DensityChoice /> },
    { type: "divider" as const },
    { key: "signout", icon: <NxIcon name="logout" size={16} />, label: "Sign out", onClick: () => void auth.signOut() },
  ].filter(<T,>(item: T | false): item is T => item !== false);
}

/** The profile menu, opened from whichever button the current layout draws. */
export function UserMenu({
  placement,
  children,
}: {
  placement: DropdownProps["placement"];
  children: ReactNode;
}) {
  const items = useUserMenuItems();
  const [open, setOpen] = useState(false);
  useEscapeToClose(open, useCallback(() => setOpen(false), []));
  return (
    <Dropdown menu={{ items }} trigger={["click"]} open={open} onOpenChange={setOpen} placement={placement}>
      {children}
    </Dropdown>
  );
}

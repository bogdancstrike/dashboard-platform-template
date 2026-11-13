import { App as AntApp } from "antd";
import { useNavigate } from "react-router-dom";

import { usePageCommands } from "@/commands/CommandContext";
import { chime } from "@/lib/chime";
import { PREFERENCE_DEFAULTS, usePreferences } from "@/settings/PreferencesProvider";
import { useAppearance } from "@/theme/AppearanceProvider";

/** The reader's preferences, the pop-up preview, and the page's commands. */
export function usePreferencesPage() {
  const navigate = useNavigate();
  const { message, notification } = AntApp.useApp();
  const prefs = usePreferences();
  const { preferences, save } = prefs;
  const { setAppearance, setDensity } = useAppearance();
  const notifications = preferences.notifications;

  /**
   * Show what a pop-up looks like, here and now.
   *
   * The one control on this page whose effect cannot be shown *beside* it —
   * everything else prints its own worked example — so it is offered as a
   * button instead. A reader turning pop-ups on wants to know what they have
   * agreed to before the first real one arrives at an inconvenient moment.
   */
  const preview = () => {
    if (notifications.popups === "none") {
      message.info("Pop-ups are off. Turn them on to see one.");
      return;
    }
    // The sound too, which the first version of this forgot — a "Try it" that
    // shows the card and stays silent is the one control on the page that
    // does not do what it says.
    if (notifications.sound) chime();
    notification.open({
      message: "This is a pop-up",
      description:
        notifications.popup_style === "compact"
          ? undefined
          : "Real ones name what happened and link to it.",
      placement: notifications.popup_placement,
      duration: notifications.popup_seconds,
    });
  };

  usePageCommands("preferences", [
    {
      id: "preferences.reset",
      label: "Reset my preferences to the defaults",
      keywords: "default restore appearance format",
      run: () => {
        setAppearance(PREFERENCE_DEFAULTS.appearance.theme);
        setDensity(PREFERENCE_DEFAULTS.appearance.density);
        save({ formats: PREFERENCE_DEFAULTS.formats, defaults: PREFERENCE_DEFAULTS.defaults });
      },
    },
    {
      id: "preferences.sidebar",
      label: preferences.appearance.sidebar_collapsed
        ? "Keep the navigation expanded"
        : "Keep the navigation collapsed to icons",
      keywords: "sidebar navigation collapse expand rail icons width",
      run: () =>
        save({
          appearance: { sidebar_collapsed: !preferences.appearance.sidebar_collapsed },
        }),
    },
    {
      id: "preferences.security",
      label: "See where I am signed in",
      keywords: "security sessions sign-ins devices revoke",
      run: () => navigate("/settings/security"),
    },
  ]);

  return { ...prefs, preview };
}

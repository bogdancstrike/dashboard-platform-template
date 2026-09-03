import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import {
  BgColorsOutlined,
  ColumnHeightOutlined,
  MoonOutlined,
  SearchOutlined,
  SunOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useLocation, useNavigate } from "react-router-dom";

import { NAV_GROUPS, NAV_ITEMS, selectedKeyFor } from "@/app/navigation";
import { useAuth } from "@/auth/AuthProvider";
import { useCommands, type PageCommand } from "@/commands/CommandContext";
import { useAppearance } from "@/theme/AppearanceProvider";
import type { Density } from "@/theme/tokens";

export const isMacPlatform =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The command palette (§31) — fast search and fast actions, on `cmdk`.
 *
 * Not a search *page*. It is the keyboard route to anywhere and anything: type
 * three letters, hit Enter, be there. Four groups, in the order somebody
 * reaches for them:
 *
 * 1. **On this page** — what the current screen can do right now. Pages
 *    contribute these through `usePageCommands`, so the group is never stale.
 * 2. **General** — every destination in the application, and (later) matching
 *    records from the server.
 * 3. **Quick views** — saved searches and saved views, the things somebody
 *    returns to daily.
 * 4. **Settings** — appearance and density, the two preferences people change
 *    often enough to want without hunting for a screen.
 *
 * `cmdk` does the fuzzy matching and the keyboard model; everything here is
 * about what goes in the list.
 */
export function CommandPalette() {
  const { open, setOpen, commands } = useCommands();
  const navigate = useNavigate();
  const location = useLocation();
  const { appearance, mode, density, setAppearance, setDensity } = useAppearance();
  const { can } = useAuth();
  const [query, setQuery] = useState("");

  // A palette that reopens showing the last search is a palette that answers
  // the previous question.
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const close = (run: () => void) => {
    setOpen(false);
    run();
  };

  const currentLabel = useMemo(() => {
    const key = selectedKeyFor(location.pathname);
    return NAV_ITEMS.find((item) => item.key === key)?.label ?? "this page";
  }, [location.pathname]);

  const settingsCommands: PageCommand[] = useMemo(
    () => [
      {
        id: "theme",
        label: mode === "dark" ? "Switch to the light theme" : "Switch to the dark theme",
        icon: mode === "dark" ? <SunOutlined /> : <MoonOutlined />,
        keywords: "appearance dark light colour color theme",
        run: () => setAppearance(mode === "dark" ? "light" : "dark"),
      },
      {
        id: "theme-system",
        label: "Follow the system theme",
        icon: <BgColorsOutlined />,
        keywords: "appearance auto os system",
        run: () => setAppearance("system"),
      },
      ...(["compact", "middle", "comfortable"] as Density[])
        .filter((option) => option !== density)
        .map((option) => ({
          id: `density-${option}`,
          label: `Use ${option} density`,
          icon: <ColumnHeightOutlined />,
          keywords: "density rows spacing size table",
          run: () => setDensity(option),
        })),
    ],
    [mode, density, setAppearance, setDensity, appearance],
  );

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      className="nu-cmdk"
      shouldFilter
    >
      <div className="nu-cmdk-input">
        <SearchOutlined />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search pages, records and actions…"
          autoFocus
        />
        <kbd>esc</kbd>
      </div>

      <Command.List>
        <Command.Empty>
          <span className="nu-cmdk-empty">Nothing matches “{query}”.</span>
        </Command.Empty>

        {commands.length > 0 && (
          <Command.Group heading={`On ${currentLabel}`}>
            {commands.map((command) => (
              <Command.Item
                key={command.id}
                value={`page:${command.id}:${command.label} ${command.keywords ?? ""}`}
                onSelect={() => close(command.run)}
              >
                <span className="nu-cmdk-icon">{command.icon ?? <ThunderboltOutlined />}</span>
                <span className="nu-cmdk-label">{command.label}</span>
                {command.shortcut && <kbd>{command.shortcut}</kbd>}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        <Command.Group heading="General">
          {NAV_GROUPS.flatMap((group) =>
            group.items.filter((item) => can(item.permission)).map((item) => (
              <Command.Item
                key={item.key}
                value={`nav:${item.key}:${group.label} ${item.label}`}
                onSelect={() => close(() => navigate(item.key))}
              >
                <span className="nu-cmdk-icon">{item.icon}</span>
                <span className="nu-cmdk-label">{item.label}</span>
                <span className="nu-cmdk-hint">{group.label}</span>
              </Command.Item>
            )),
          )}
        </Command.Group>

        <Command.Group heading="Quick views">
          <Command.Item
            value="view:saved-searches"
            onSelect={() => close(() => navigate("/explore?panel=saved"))}
          >
            <span className="nu-cmdk-icon">
              <SearchOutlined />
            </span>
            <span className="nu-cmdk-label">All saved searches</span>
          </Command.Item>
          <Command.Item value="view:favorites" onSelect={() => close(() => navigate("/favorites"))}>
            <span className="nu-cmdk-icon">
              <SearchOutlined />
            </span>
            <span className="nu-cmdk-label">Favorites</span>
          </Command.Item>
        </Command.Group>

        <Command.Group heading="Settings">
          {settingsCommands.map((command) => (
            <Command.Item
              key={command.id}
              value={`setting:${command.id}:${command.label} ${command.keywords ?? ""}`}
              onSelect={() => close(command.run)}
            >
              <span className="nu-cmdk-icon">{command.icon}</span>
              <span className="nu-cmdk-label">{command.label}</span>
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}

/** The sidebar trigger, under the logo (§31). */
export function CommandTrigger({ collapsed }: { collapsed: boolean }) {
  const { setOpen } = useCommands();
  const chord = `${isMacPlatform ? "⌘" : "Ctrl"} K`;

  return (
    <div className={`nu-fast${collapsed ? " nu-fast--collapsed" : ""}`}>
      {!collapsed && <div className="nu-fast-heading">Fast actions</div>}
      <button
        type="button"
        className="nu-fast-trigger"
        onClick={() => setOpen(true)}
        aria-label={`Open the command palette (${chord})`}
        title={`Command palette · ${chord}`}
      >
        <SearchOutlined />
        {!collapsed && (
          <>
            <span className="nu-fast-label">Search or jump to…</span>
            <kbd>{chord}</kbd>
          </>
        )}
      </button>
    </div>
  );
}

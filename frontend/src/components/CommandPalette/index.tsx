import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { FileSearchOutlined, SearchOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { useLocation, useNavigate } from "react-router-dom";

import { FEATURES, navItemFlag, useFeatures } from "@/settings/features";
import { NAV_GROUPS, NAV_ITEMS, selectedKeyFor } from "@/app/navigation";
import { useAuth } from "@/auth/AuthProvider";
import { useCommands } from "@/commands/CommandContext";

import { recordAddress } from "./palette";

import { useRecordHits, useSettingsCommands } from "./paletteHooks";

export { CommandTrigger } from "./CommandTrigger";
export { isMacPlatform, recordAddress } from "./palette";

/**
 * The command palette (§31) — fast search and fast actions, on `cmdk`.
 *
 * Not a search *page*. It is the keyboard route to anywhere and anything: type
 * three letters, hit Enter, be there. Four groups, in the order somebody
 * reaches for them:
 *
 * 1. **On this page** — what the current screen can do right now. Pages
 *    contribute these through `usePageCommands`, so the group is never stale.
 * 2. **Records** — the records themselves, from the server, once two letters
 *    are typed. This is what the palette is *for*: somebody who knows
 *    "TSK-00042" should reach it without choosing a page first, and the
 *    alternative is three navigations and a filter. It was "later" for the
 *    life of the project (§31, §32).
 * 3. **General** — every destination in the application.
 * 4. **Quick views** — saved searches and saved views, the things somebody
 *    returns to daily.
 * 5. **Settings** — appearance and density, the two preferences people change
 *    often enough to want without hunting for a screen.
 *
 * `cmdk` does the fuzzy matching and the keyboard model; everything here is
 * about what goes in the list.
 */
export function CommandPalette() {
  const { open, setOpen, commands } = useCommands();
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = useAuth();
  const features = useFeatures();
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

  const { records, hits, term } = useRecordHits(open, query);

  const currentLabel = useMemo(() => {
    const key = selectedKeyFor(location.pathname);
    return NAV_ITEMS.find((item) => item.key === key)?.label ?? "this page";
  }, [location.pathname]);

  const settingsCommands = useSettingsCommands();

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

        {/* Pages before records: typing a page's name and pressing Enter
            should open the page, not the first ticket that mentions the word
            (cmdk keeps DOM order between equal scores; audit A). */}
        <Command.Group heading="General">
          {NAV_GROUPS.flatMap((group) =>
            group.items
              .filter((item) => can(item.permission))
              .filter((item) => {
                // Switched-off features are not offered (§27).
                const flag = navItemFlag(item);
                return !flag || features(flag);
              })
              .map((item) => (
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

        {records.length > 0 && (
          <Command.Group heading={`Records matching “${hits.data?.query ?? term}”`}>
            {records.map(({ hit, path, dataset }) => (
              <Command.Item
                key={`${hit.resource_type}:${hit.id}`}
                // The matched text is *in* the value, because cmdk filters
                // every item against the term again — including these, which
                // the server already matched. Without the snippet, a record
                // found by its description is mounted and then hidden by a
                // fuzzy match against its reference.
                value={`record:${hit.resource_type}:${hit.id}:${hit.label} ${hit.summary} ${hit.snippet}`}
                onSelect={() => close(() => navigate(recordAddress(hit, path)))}
              >
                <span className="nu-cmdk-icon">
                  <FileSearchOutlined />
                </span>
                <span className="nu-cmdk-label">{hit.label}</span>
                <span className="nu-cmdk-hint">
                  {dataset} · {hit.matched_label}
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        <Command.Group heading="Quick views">
          {features(FEATURES.savedViews) && (
            <Command.Item
              value="view:saved-searches"
              onSelect={() => close(() => navigate("/explore?panel=saved"))}
            >
              <span className="nu-cmdk-icon">
                <SearchOutlined />
              </span>
              <span className="nu-cmdk-label">All saved searches</span>
            </Command.Item>
          )}
          {features(FEATURES.favorites) && (
            <Command.Item value="view:favorites" onSelect={() => close(() => navigate("/favorites"))}>
              <span className="nu-cmdk-icon">
                <SearchOutlined />
              </span>
              <span className="nu-cmdk-label">Favorites</span>
            </Command.Item>
          )}
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
      <div className="nx-fd-cmdk-foot" aria-hidden="true">
        <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
        <span><kbd>↵</kbd> Open</span>
        <span><kbd>esc</kbd> Close</span>
        <span className="nx-fd-push">Commands for this page come first</span>
      </div>
    </Command.Dialog>
  );
}

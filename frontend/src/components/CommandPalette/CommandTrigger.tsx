import { SearchOutlined } from "@ant-design/icons";

import { useCommands } from "@/commands/CommandContext";

import { isMacPlatform } from "./palette";

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

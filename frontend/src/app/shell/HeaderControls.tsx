import { Tooltip } from "antd";
import { Link } from "react-router-dom";

import { NxIcon } from "@/components/NxIcon";
import { useCommands } from "@/commands/CommandContext";
import { useLive } from "@/live/LiveProvider";
import { useAppearance } from "@/theme/AppearanceProvider";

/** Breadcrumbs from the navigation itself; the last one is the current page. */
export function Breadcrumbs({ trail }: { trail: { label: string; key: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="nx-crumbs">
      <ol>
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1;
          return (
            <li key={`${index}:${crumb.key}`}>
              {index > 0 && <NxIcon name="chevronRight" size={12} stroke={2.4} className="nx-crumb-sep" />}
              <Link
                to={crumb.key}
                aria-current={last ? "page" : undefined}
                className={last ? "nx-crumb nx-crumb--last" : "nx-crumb"}
              >
                {crumb.label}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function ThemeButton() {
  const { mode, setAppearance } = useAppearance();
  return (
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
}

/** Whether pages update live or by polling (§17). */
export function LiveChip() {
  const live = useLive();
  return (
    <span className={`nx-live nx-live--${live.status}`} data-testid="live-status">
      <i aria-hidden="true" />
      {live.status === "live" ? "Live" : live.status === "connecting" ? "Connecting" : "Polling · 30 s"}
    </span>
  );
}

/** The large search button the tablet and phone headers open the palette with. */
export function PaletteButton() {
  const { setOpen } = useCommands();
  return (
    <button
      type="button"
      className="nx-iconbtn nx-iconbtn--lg"
      aria-label="Open the command palette"
      onClick={() => setOpen(true)}
    >
      <NxIcon name="search" stroke={2} />
    </button>
  );
}

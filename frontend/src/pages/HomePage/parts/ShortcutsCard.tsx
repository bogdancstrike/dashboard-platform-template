import { Card } from "antd";
import { Link } from "react-router-dom";

import type { HomePageData } from "../useHomePage";

/** The doors out of the lobby the reader may open. */
export function ShortcutsCard({ page }: { page: HomePageData }) {
  const { doors } = page;
  return (
    <>
      {/* A front door with no doors is a lobby. Permission-aware, so the row
          holds nothing that opens onto a refusal (§76). */}
      <Card size="small" title="Where to start" data-testid="home-shortcuts">
        <div className="nu-home-doors">
          {doors.map((door) => (
            <Link key={door.key} to={door.to} className="nu-door" data-testid={`door-${door.key}`}>
              <span className="nu-door-icon" aria-hidden>
                {door.icon}
              </span>
              <span className="nu-door-text">
                <span className="nu-door-label">{door.label}</span>
                <span className="nu-door-hint">{door.hint}</span>
              </span>
            </Link>
          ))}
        </div>
      </Card>
    </>
  );
}

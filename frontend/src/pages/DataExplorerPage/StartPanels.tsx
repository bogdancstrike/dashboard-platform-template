import { useState } from "react";

import { FdIcon } from "@/components/icons/FdIcon";
import { NxIcon } from "@/components/NxIcon";
import { useRecentSearches } from "@/hooks/useRecentSearches";

/**
 * What you asked before and what you saved, as one compact line of chips
 * under the search bar — never more than a row, so the results stay where
 * the eye expects them. Overflow folds into "+N more"; the saved overflow
 * opens the saved-search drawer.
 */
export const RECENT_SHOWN = 4;

export function StartPanels({ dataset, label, onAsk }: {
  dataset: string;
  label: string;
  onAsk: (term: string) => void;
}) {
  const recent = useRecentSearches(dataset);
  const [allRecent, setAllRecent] = useState(false);
  const terms = allRecent ? recent.terms : recent.terms.slice(0, RECENT_SHOWN);
  const moreRecent = recent.terms.length - RECENT_SHOWN;

  if (recent.terms.length === 0) return null;

  return (
    <div className={`nx-fd-quick${allRecent ? " is-open" : ""}`} aria-label={`Recent searches in ${label.toLowerCase()}`}>
      {recent.terms.length > 0 && (
        <div className="nx-fd-quickgroup" role="group" aria-labelledby="nx-fd-recent">
          <h2 id="nx-fd-recent" className="nx-fd-eyebrow">Recent searches</h2>
          {terms.map((term) => (
            <span className="nx-fd-qchip" key={term}>
              <button type="button" className="nx-fd-qchip-main" onClick={() => onAsk(term)}>
                <FdIcon name="clock" size={12} />
                {term}
              </button>
              <button type="button" className="nx-fd-qchip-x" aria-label={`Remove recent search: ${term}`} onClick={() => recent.forget(term)}>
                <NxIcon name="close" size={10} />
              </button>
            </span>
          ))}
          {moreRecent > 0 && (
            <button type="button" className="nx-fd-qmore" onClick={() => setAllRecent((open) => !open)}>
              {allRecent ? "Fewer" : `+${moreRecent} more`}
            </button>
          )}
          <button type="button" className="nx-fd-link nx-fd-tiny" onClick={recent.clear}>Clear</button>
        </div>
      )}
    </div>
  );
}

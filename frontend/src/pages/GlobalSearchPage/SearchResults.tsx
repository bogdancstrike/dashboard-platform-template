import { Link } from "react-router-dom";
import { Skeleton, Tooltip } from "antd";
import { ArrowRightOutlined, SearchOutlined } from "@ant-design/icons";
import { type GlobalHit } from "@/api/search";
import { HighlightedText } from "@/components/HighlightedText";
import { EmptyState } from "@/components/EmptyState";

import type { GlobalSearchModel } from "./useGlobalSearch";

/** The hits, grouped by dataset — the cursor's row marked. */
export function SearchResults({ m }: { m: GlobalSearchModel }) {
  const { term, cursor, setCursor, listRef, results, flattened, open, tooShort, shown } = m;
  return (
    <div ref={listRef} className="nu-global-results nx-fd-ggrid">
      {results.isLoading && <Skeleton active paragraph={{ rows: 6 }} />}

      {!term.trim() && !results.isLoading && (
        <EmptyState compact title="Search for a reference, a name, an address — anything a record carries." />
      )}

      {results.data && results.data.total === 0 && !tooShort && term.trim() && (
        <EmptyState title={`Nothing matches “${results.data.query}”`} />
      )}

      {results.data && shown.map((group) => {
        const offset = flattened.indexOf(group.items[0] as GlobalHit);
        return (
          <section key={group.resource_type} className="nu-global-group nx-fd-gcard nx-glass" aria-label={group.label}>
            <div className="nx-fd-row">
              <h2 className="nx-fd-h2">{group.label}</h2>
              <Tooltip title={`Explore ${group.label.toLowerCase()} matching this term`}>
                <Link
                  className="nx-fd-push nx-fd-alllink"
                  to={`/explore?resource=${group.resource_type}&q=${encodeURIComponent(results.data.query)}`}
                >
                  <SearchOutlined /> {group.has_more ? "See all in Data Explorer" : "Open in Data Explorer"}
                </Link>
              </Tooltip>
            </div>
            {group.items.map((hit, index) => (
              <button
                key={hit.id}
                type="button"
                data-hit
                data-testid="global-hit"
                className={`nu-global-hit nx-fd-ghit${offset + index === cursor ? " is-active" : ""}`}
                onClick={() => open(hit)}
                onMouseEnter={() => setCursor(offset + index)}
              >
                <span className="nx-fd-ghit-main">
                  <span className="nx-fd-ghit-label">
                    <HighlightedText text={hit.label} term={results.data.query} />
                  </span>
                  <span className="nx-fd-muted nx-fd-small">{hit.summary}</span>
                  {hit.snippet && (
                    <span className="nx-fd-ghit-snippet">
                      <span className="nx-fd-pill">{hit.matched_label}</span>
                      <span className="nx-fd-muted nx-fd-small">
                        <HighlightedText text={hit.snippet} term={results.data.query} />
                      </span>
                    </span>
                  )}
                </span>
                <ArrowRightOutlined className="nu-global-hit-go" />
              </button>
            ))}
          </section>
        );
      })}
    </div>
  );
}

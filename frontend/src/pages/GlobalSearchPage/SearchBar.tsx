import { Typography } from "antd";
import { SimpleSearch } from "@/components/explorer/SimpleSearch";

import type { GlobalSearchModel } from "./useGlobalSearch";

/** The search box and the dataset chips, with the keyboard hint. */
export function SearchBar({ m }: { m: GlobalSearchModel }) {
  const { params, setParams, term, results, onKeyDown, groups, only, setType } = m;
  const { Text } = Typography;
  return (
    <section className="nx-fd-bar nx-glass nx-glass--strong nx-fd-gbar" aria-label="Search">
      <div className="nx-fd-bar-row">
        {/* The same box as the explorer, with its own history. */}
        <div className="nx-fd-q" onKeyDown={onKeyDown}>
          <SimpleSearch
            dataset="global"
            label="everything"
            value={term}
            onChange={(next) => {
              const search = new URLSearchParams(params);
              if (next) search.set("q", next);
              else search.delete("q");
              setParams(search, { replace: true });
            }}
          />
        </div>
        {groups.length > 0 && (
          <div className="nx-fd-typechips" role="group" aria-label="Record types">
            <button type="button" className={!only ? "is-on" : ""} aria-pressed={!only} onClick={() => setType("")}>
              All <span>{results.data?.total ?? 0}</span>
            </button>
            {groups.map((group) => (
              <button
                key={group.resource_type}
                type="button"
                className={only === group.resource_type ? "is-on" : ""}
                aria-pressed={only === group.resource_type}
                onClick={() => setType(only === group.resource_type ? "" : group.resource_type)}
              >
                {group.label} <span>{group.items.length}{group.has_more ? "+" : ""}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <Text type="secondary" className="nx-fd-hint">
        Use ↑ and ↓ to move through the results and Enter to open one.
      </Text>
    </section>
  );
}

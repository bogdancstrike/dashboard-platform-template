/**
 * Global search (§32) — one term, every dataset, ranked against each other.
 *
 * The question this answers is not "which tasks match?" but "where does this
 * appear at all?", which is what somebody has when they hold a reference
 * number and do not know which screen it belongs to. So results are grouped by
 * dataset, the strongest group first, and every hit says which field matched
 * and shows the text around it.
 *
 * It is keyboard-first, because that is how the question is usually asked:
 * arrow keys walk the flattened result list across group boundaries and Enter
 * opens the highlighted one, without the reader's hand leaving the box.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Skeleton, Tooltip, Typography } from "antd";
import {
  ArrowRightOutlined,
  ClearOutlined,
  DatabaseOutlined,
  FilterOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { usePageCommands } from "@/commands/CommandContext";

import { searchApi, type GlobalHit } from "@/api/search";
import { HighlightedText } from "@/components/HighlightedText";
import { PageHeader } from "@/components/PageHeader";
import { SimpleSearch } from "@/components/explorer/SimpleSearch";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { EmptyState } from "@/components/EmptyState";
import { queryKeys } from "@/lib/queryKeys";

const { Text } = Typography;

/** Matches MIN_TERM in services/search.py. */
const MIN_TERM = 2;

export default function GlobalSearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const term = params.get("q") ?? "";
  const debounced = useDebouncedValue(term.trim(), 280);
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useQuery({
    queryKey: queryKeys.globalSearch(debounced),
    queryFn: ({ signal }) => searchApi.global(debounced, signal),
    enabled: debounced.length >= MIN_TERM,
    placeholderData: (previous) => previous,
  });

  // One flat list across the groups: the keyboard does not care where a
  // dataset ends, and neither does somebody looking for one record.
  const flattened = useMemo(
    () => (results.data?.groups ?? []).flatMap((group) => group.items),
    [results.data],
  );

  useEffect(() => setCursor(0), [debounced]);

  /**
   * What this page can do, for the palette (§31).
   *
   * The palette searches records itself, so the useful commands here are the
   * ones it cannot do: taking a term that matched too much into a page that
   * can narrow it, and clearing a term that matched nothing.
   */
  usePageCommands("global-search", [
    ...(term
      ? [
          {
            id: "search.explore",
            label: "Narrow this search in the explorer",
            icon: <FilterOutlined />,
            keywords: "filter refine conditions advanced narrow",
            run: () => navigate(`/explore?q=${encodeURIComponent(term)}`),
          },
          {
            id: "search.clear",
            label: "Clear the search",
            icon: <ClearOutlined />,
            keywords: "reset empty start over",
            run: () => setParams({}, { replace: true }),
          },
        ]
      : []),
    {
      id: "search.catalogue",
      label: "See what there is to search",
      icon: <DatabaseOutlined />,
      keywords: "catalog datasets fields schema declaration",
      run: () => navigate("/find/catalog"),
    },
  ]);

  /**
   * Where a hit lives: its own record page when the dataset has one (the
   * server publishes the path for exactly this), else the explorer narrowed to
   * that one record. Opening a customer used to land on a one-row explorer
   * table, a click away from the customer.
   */
  const open = (hit: GlobalHit) => {
    const path = results.data?.groups.find((group) => group.resource_type === hit.resource_type)?.path;
    navigate(path ? `${path}/${hit.id}` : `/explore?resource=${hit.resource_type}&f.id=${hit.id}`);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (flattened.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = (cursor + step + flattened.length) % flattened.length;
      setCursor(next);
      const hits = listRef.current?.querySelectorAll("[data-hit]");
      hits?.[next]?.scrollIntoView({ block: "nearest" });
    }
    if (event.key === "Enter") {
      const hit = flattened[cursor];
      if (hit) {
        event.preventDefault();
        open(hit);
      }
    }
  };

  const tooShort = term.trim().length > 0 && term.trim().length < MIN_TERM;
  const groups = results.data?.groups ?? [];
  const only = params.get("type") ?? "";
  const shown = only ? groups.filter((group) => group.resource_type === only) : groups;
  const setType = (next: string) => {
    const search = new URLSearchParams(params);
    if (next) search.set("type", next);
    else search.delete("type");
    setParams(search, { replace: true });
  };

  return (
    <div className="nx-fd-global">
      <PageHeader
        title="Search"
        subtitle={
          results.data && term.trim()
            ? `“${results.data.query}” · ${results.data.total} ${results.data.total === 1 ? "result" : "results"} across ${groups.length} record ${groups.length === 1 ? "type" : "types"}`
            : "One term across every dataset you can read, ranked by how well it matched."
        }
        tag={
          results.data && results.data.total > 0 ? (
            <span className="nx-fd-sr" data-testid="global-total">
              {results.data.total} {results.data.total === 1 ? "result" : "results"}
            </span>
          ) : undefined
        }
      />

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

      {results.isError && (
        <Alert
          type="error"
          showIcon
          message="The search could not be run"
          description={results.error instanceof Error ? results.error.message : "Unknown error"}
        />
      )}

      {tooShort && (
        <Alert type="info" showIcon message={`Type at least ${MIN_TERM} characters to search.`} />
      )}

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
    </div>
  );
}

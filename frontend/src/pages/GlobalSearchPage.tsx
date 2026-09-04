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
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Badge, Button, Card, Empty, Skeleton, Space, Tag, Tooltip, Typography } from "antd";
import { ArrowRightOutlined, SearchOutlined } from "@ant-design/icons";

import { searchApi, type GlobalHit } from "@/api/search";
import { HighlightedText } from "@/components/HighlightedText";
import { PageHeader } from "@/components/PageHeader";
import { SimpleSearch } from "@/components/explorer/SimpleSearch";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

const { Text, Title } = Typography;

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
    queryKey: ["global-search", debounced],
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

  /** Where a hit lives: the explorer, narrowed to that one record. */
  const open = (hit: GlobalHit) => {
    navigate(`/explore?resource=${hit.resource_type}&f.id=${hit.id}`);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (flattened.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = (cursor + step + flattened.length) % flattened.length;
      setCursor(next);
      listRef.current
        ?.querySelectorAll("[data-hit]")
        [next]?.scrollIntoView({ block: "nearest" });
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

  return (
    <>
      <PageHeader
        title="Global search"
        subtitle="One term across every dataset you can read, ranked by how well it matched."
        tag={
          results.data && results.data.total > 0 ? (
            <Tag color="blue" data-testid="global-total">
              {results.data.total} {results.data.total === 1 ? "result" : "results"}
            </Tag>
          ) : undefined
        }
      />

      <Card size="small" className="nu-global-search-box">
        {/* The same box as the explorer, with its own history. */}
        <div onKeyDown={onKeyDown}>
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
        <Text type="secondary">
          Use ↑ and ↓ to move through the results and Enter to open one.
        </Text>
      </Card>

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

      <div ref={listRef} className="nu-global-results">
        {results.isLoading && <Skeleton active paragraph={{ rows: 6 }} />}

        {!term.trim() && !results.isLoading && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Search for a reference, a name, an address — anything a record carries."
          />
        )}

        {results.data && results.data.total === 0 && !tooShort && term.trim() && (
          <Empty description={`Nothing matches “${results.data.query}”`} />
        )}

        {results.data?.groups.map((group) => {
          const offset = flattened.indexOf(group.items[0] as GlobalHit);
          return (
            <Card
              key={group.resource_type}
              className="nu-global-group"
              size="small"
              title={
                <Space>
                  <Title level={5}>{group.label}</Title>
                  <Badge count={group.items.length} color="blue" />
                </Space>
              }
              extra={
                <Tooltip title={`Explore ${group.label.toLowerCase()} matching this term`}>
                  <Button
                    type="link"
                    icon={<SearchOutlined />}
                    onClick={() =>
                      navigate(
                        `/explore?resource=${group.resource_type}&q=${encodeURIComponent(results.data.query)}`,
                      )
                    }
                  >
                    {group.has_more ? "See all in Data Explorer" : "Open in Data Explorer"}
                  </Button>
                </Tooltip>
              }
            >
              {group.items.map((hit, index) => (
                <button
                  key={hit.id}
                  type="button"
                  data-hit
                  data-testid="global-hit"
                  className={`nu-global-hit${offset + index === cursor ? " is-active" : ""}`}
                  onClick={() => open(hit)}
                  onMouseEnter={() => setCursor(offset + index)}
                >
                  <div className="nu-global-hit-head">
                    <Text strong>
                      <HighlightedText text={hit.label} term={results.data.query} />
                    </Text>
                    <Text type="secondary">{hit.summary}</Text>
                  </div>
                  {hit.snippet && (
                    <div className="nu-global-hit-snippet">
                      <Tag>{hit.matched_label}</Tag>
                      <Text type="secondary">
                        <HighlightedText text={hit.snippet} term={results.data.query} />
                      </Text>
                    </div>
                  )}
                  <ArrowRightOutlined className="nu-global-hit-go" />
                </button>
              ))}
            </Card>
          );
        })}
      </div>
    </>
  );
}

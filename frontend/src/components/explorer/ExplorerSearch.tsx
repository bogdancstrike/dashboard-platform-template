/**
 * The explorer's search box: this dataset, and everywhere else (§4, §32).
 *
 * Typing still searches the dataset on screen — that is what the box is for,
 * and the rows behind it narrow as the term is typed. What the dropdown adds
 * is the answer to the question the reader has when nothing comes back: *the
 * record exists, it is simply not a task*. Ranked hits from every other
 * dataset sit under the current one, so noticing that costs a glance rather
 * than a second search on another screen.
 *
 * Per-field narrowing lives in the condition builder next to this box. A row
 * of facet menus below it offered a worse version of the same thing — three
 * fields chosen for you, one value each, no way to say "not this" — and cost a
 * `GROUP BY` per field on every keystroke to render.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AutoComplete, Button, Input, Space, Tag, Tooltip, Typography } from "antd";
import { CloseOutlined, GlobalOutlined, HistoryOutlined, SearchOutlined } from "@ant-design/icons";

import { searchApi } from "@/api/search";
import { HighlightedText } from "@/components/HighlightedText";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRecentSearches } from "@/hooks/useRecentSearches";

const { Text } = Typography;

/** Matches MIN_TERM in services/search.py. */
const MIN_TERM = 2;
/** Enough to show the term is found elsewhere; the rest are one click away. */
const ELSEWHERE_PER_GROUP = 3;

export interface ExplorerSearchProps {
  /** The dataset being explored; its own history, and the group excluded below. */
  dataset: string;
  /** What that dataset is called, for the placeholder and the first group. */
  label: string;
  value: string;
  onChange: (term: string) => void;
}

export function ExplorerSearch({ dataset, label, value, onChange }: ExplorerSearchProps) {
  const navigate = useNavigate();
  const recent = useRecentSearches(dataset);
  const term = value.trim();
  const debounced = useDebouncedValue(term, 280);

  const elsewhere = useQuery({
    queryKey: ["global-search", debounced],
    queryFn: ({ signal }) => searchApi.global(debounced, signal),
    enabled: debounced.length >= MIN_TERM,
    // Shared with the global search page, and names do not change while a
    // dropdown is open.
    staleTime: 30_000,
  });

  const options = useMemo(() => {
    const groups: Array<{ label: React.ReactNode; options: Array<{ value: string; label: React.ReactNode }> }> = [];

    const history = recent.terms.filter(
      (item) => item !== value && item.toLowerCase().includes(term.toLowerCase()),
    );
    if (history.length > 0) {
      groups.push({
        label: (
          <div className="nu-recent-heading">
            <Text type="secondary">Recent searches</Text>
            <button
              type="button"
              className="nu-link-button nu-recent-clear"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => recent.clear()}
            >
              Clear
            </button>
          </div>
        ),
        options: history.map((item) => ({
          value: `term:${item}`,
          label: (
            <div className="nu-recent-option">
              <Space size={6}><HistoryOutlined /><span>{item}</span></Space>
              <Tooltip title="Forget this search">
                <Button
                  type="text"
                  size="small"
                  icon={<CloseOutlined />}
                  aria-label={`Forget ${item}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation();
                    recent.forget(item);
                  }}
                />
              </Tooltip>
            </div>
          ),
        })),
      });
    }

    // Everything but the dataset already on screen: its matches are the rows
    // behind the dropdown, and repeating them here would be the same answer twice.
    const other = (elsewhere.data?.groups ?? []).filter(
      (group) => group.resource_type !== dataset,
    );
    for (const group of other) {
      groups.push({
        label: (
          <div className="nu-recent-heading">
            <Space size={6}><GlobalOutlined /><Text type="secondary">{group.label}</Text></Space>
            <Text type="secondary">{group.has_more ? "top matches" : `${group.items.length}`}</Text>
          </div>
        ),
        options: group.items.slice(0, ELSEWHERE_PER_GROUP).map((hit) => ({
          value: `record:${hit.resource_type}:${hit.id}`,
          label: (
            <div className="nu-elsewhere-option">
              <Space size={8}>
                <Text strong>
                  <HighlightedText text={hit.label} term={debounced} />
                </Text>
                <Text type="secondary">{hit.summary}</Text>
              </Space>
              <Tag>{hit.matched_label}</Tag>
            </div>
          ),
        })),
      });
    }

    if (other.length > 0) {
      groups.push({
        label: <Text type="secondary">Everywhere</Text>,
        options: [
          {
            value: `global:${term}`,
            label: (
              <Space size={6}>
                <SearchOutlined />
                <span>See every match for “{term}”</span>
              </Space>
            ),
          },
        ],
      });
    }
    return groups;
  }, [recent, value, term, debounced, elsewhere.data, dataset]);

  /**
   * One dropdown, three kinds of entry, so the value carries its own meaning
   * rather than the handler guessing from the text.
   */
  const select = (selected: string) => {
    if (selected.startsWith("term:")) {
      const chosen = selected.slice("term:".length);
      onChange(chosen);
      recent.remember(chosen);
      return;
    }
    if (selected.startsWith("record:")) {
      const [, resource, id] = selected.split(":");
      navigate(`/explore?resource=${resource}&f.id=${id}`);
      return;
    }
    if (selected.startsWith("global:")) {
      navigate(`/find/global?q=${encodeURIComponent(selected.slice("global:".length))}`);
    }
  };

  return (
    <AutoComplete
      className="nu-simple-search"
      value={value}
      options={options}
      popupMatchSelectWidth={520}
      filterOption={false}
      onChange={onChange}
      onSelect={select}
      data-testid="explorer-search"
    >
      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder={`Search ${label}, and everywhere else…`}
        aria-label={`Search ${label}`}
        onPressEnter={() => recent.remember(value)}
        onBlur={() => recent.remember(value)}
      />
    </AutoComplete>
  );
}

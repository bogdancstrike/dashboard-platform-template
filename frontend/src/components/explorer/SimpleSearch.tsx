/**
 * One box across every searchable field, with what you asked before (§4).
 *
 * Recent searches are the only suggestion offered, and deliberately so. A
 * suggestion drawn from the data would have to guess what the reader meant
 * from a prefix, and guessing wrong in a search box is worse than not guessing
 * — whereas "the thing I looked for on Tuesday" is a question they have
 * already asked and can recognise instantly.
 *
 * A term joins the history when it is submitted, not as it is typed: otherwise
 * every prefix of every search — `a`, `au`, `aud` — becomes a suggestion.
 */

import { useMemo } from "react";
import { AutoComplete, Button, Input, Space, Tooltip, Typography } from "antd";
import { CloseOutlined, HistoryOutlined, SearchOutlined } from "@ant-design/icons";

import { useRecentSearches } from "@/hooks/useRecentSearches";

const { Text } = Typography;

export interface SimpleSearchProps {
  /** The dataset key; each keeps its own history. */
  dataset: string;
  /** What the dataset is called, for the placeholder. */
  label: string;
  value: string;
  onChange: (term: string) => void;
}

export function SimpleSearch({ dataset, label, value, onChange }: SimpleSearchProps) {
  const recent = useRecentSearches(dataset);

  const options = useMemo(() => {
    const terms = recent.terms.filter(
      (term) => term !== value && term.toLowerCase().includes(value.trim().toLowerCase()),
    );
    if (terms.length === 0) return [];
    return [
      {
        label: (
          <div className="nu-recent-heading">
            <Text type="secondary">Recent searches</Text>
            <button
              type="button"
              className="nu-link-button nu-recent-clear"
              // The dropdown would otherwise take the click as a selection.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => recent.clear()}
            >
              Clear
            </button>
          </div>
        ),
        options: terms.map((term) => ({
          value: term,
          label: (
            <div className="nu-recent-option">
              <Space size={6}>
                <HistoryOutlined />
                <span>{term}</span>
              </Space>
              <Tooltip title="Forget this search">
                <Button
                  type="text"
                  size="small"
                  icon={<CloseOutlined />}
                  aria-label={`Forget ${term}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation();
                    recent.forget(term);
                  }}
                />
              </Tooltip>
            </div>
          ),
        })),
      },
    ];
  }, [recent, value]);

  return (
    <AutoComplete
      className="nu-simple-search"
      value={value}
      options={options}
      // The dropdown is a history, not a filter over one: the term itself is
      // already applied as it is typed.
      filterOption={false}
      onChange={onChange}
      onSelect={(term: string) => {
        onChange(term);
        recent.remember(term);
      }}
      data-testid="simple-search"
    >
      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder={`Search ${label}…`}
        aria-label={`Search ${label}`}
        onPressEnter={() => recent.remember(value)}
        onBlur={() => recent.remember(value)}
      />
    </AutoComplete>
  );
}

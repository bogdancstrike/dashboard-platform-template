import { Button, Select } from "antd";
import { ClearOutlined } from "@ant-design/icons";

import { ConditionChips } from "@/components/explorer/ConditionChips";
import { humanise } from "@/components/explorer/ConditionBuilder";
import { NxIcon } from "@/components/NxIcon";
import { ExplorerSearch } from "@/components/explorer/ExplorerSearch";
import { AskData } from "@/components/assistant/DescribeFilters";

import type { ExplorerPage } from "./useExplorerPage";

/**
 * Data Explorer is the canonical composition of platform query primitives.
 * Its entire state is URL-backed, so back/forward, bookmarks and shared links
 * reproduce the same question and presentation for another authorized user.
 */

/** Rules (or the dataset), the search box, Ask, Search — and the "Try" chips on the start screen. */
export function SearchBar({ m }: { m: ExplorerPage }) {
  const { advancedSearch, catalogue, chooseResource, mode, openPanel, queryText, resource, resources, results, set, setAdvancedOpen, setParams, stats, suggestions, tree } = m;
  return (
    <section className="nx-fd-bar nx-glass nx-glass--strong nx-fd-slim" aria-label="Search">
      <div className="nx-fd-bar-row">
        {/* Rules sits where the dataset used to: the drawer it opens
            starts with "Find [dataset] where …", so the dataset and the
            conditions on it are chosen in one place, and the label keeps
            both visible on the page. */}
        {advancedSearch ? (
          <>
            <Button
              className={`nx-fd-rulesbtn${tree ? " is-on" : ""}`}
              icon={<NxIcon name="filter" size={15} />}
              data-testid="open-rules"
              onClick={() => setAdvancedOpen(true)}
              aria-label={`Rules, ${stats.rules} ${stats.rules === 1 ? "rule" : "rules"}, on ${resource?.label ?? "this dataset"}`}
            >
              Rules
              {stats.rules > 0 && <span className="nx-fd-rulesn">· {stats.rules}</span>}
            </Button>
            <span className="nx-fd-rulesds" data-testid="rules-dataset">
              {catalogue.isLoading ? "…" : `in ${resource?.label ?? "—"}`}
            </span>
          </>
        ) : (
          // With the rule builder switched off, the drawer that chooses
          // the dataset never opens: Rules was a dead button and the page
          // was stuck on its first dataset. The plain chooser stands in.
          <Select
            className="nx-fd-datasetsel"
            aria-label="Dataset"
            data-testid="dataset-select"
            value={resource?.key}
            loading={catalogue.isLoading}
            onChange={chooseResource}
            options={resources.map((item) => ({ value: item.key, label: item.label }))}
            popupMatchSelectWidth={false}
          />
        )}
        {tree && (
          <button
            type="button"
            className="nx-fd-iconbtn is-plain"
            aria-label="Remove the rules"
            onClick={() => set({ tree: null, page: null })}
          >
            <NxIcon name="close" size={14} />
          </button>
        )}
        <div className="nx-fd-q">
          <ExplorerSearch
            dataset={resource?.key ?? "records"}
            label={resource?.label.toLowerCase() ?? "records"}
            value={queryText}
            onChange={(next: string) => set({ q: next, page: null })}
          />
        </div>
        {/* AI (§23): "Ask" — a question becomes rules, reviewed in the Rules drawer. */}
        {/* Ask hands its answer to the Rules drawer for review, so it
            is offered only where that drawer can open. */}
        {advancedSearch && (
          <AskData
            onReview={(key) =>
              key === resource?.key ? openPanel({ panel: "rules" }) : setParams(new URLSearchParams({ resource: key, panel: "rules" }))
            }
          />
        )}
        <Button type="primary" className="nx-fd-go" icon={<NxIcon name="search" size={15} />} onClick={() => void results.refetch()}>
          Search
        </Button>
      </div>
      {mode === "start" && suggestions.length > 0 && (
        <div className="nx-fd-try nx-fd-try--slim">
          <span className="nx-fd-eyebrow">Try</span>
          {suggestions.map((item) => (
            <button
              key={`${item.field}:${item.value}`}
              type="button"
              className="nx-fd-trychip"
              onClick={() => set({ [`f.${item.field}`]: item.value, page: null })}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** The question as chips — rules, field filters, the term — each removable, and Clear. */
export function QuestionChips({ m }: { m: ExplorerPage }) {
  const { activeFilterCount, clearQuestion, filters, mode, queryText, resource, set, tree } = m;
  return (
    <>
      {mode === "results" && resource && (
        <ConditionChips
          tree={tree}
          fields={resource.fields}
          extra={
            <>
              {Object.entries(filters).map(([name, values]) => {
                const field = resource.fields.find((item) => item.name === name);
                return (
                  <span className="nx-fd-chiprule is-removable" key={name}>
                    <b>{field?.label ?? name}</b>
                    <span className="nx-fd-chipop">{values.length > 1 ? "is any of" : "is"}</span>
                    <b>{values.map((value) => (field?.kind === "enum" ? humanise(value) : value)).join(", ")}</b>
                    <button type="button" aria-label={`Remove ${field?.label ?? name}`} onClick={() => set({ [`f.${name}`]: null, page: null })}>
                      <NxIcon name="close" size={11} />
                    </button>
                  </span>
                );
              })}
              {queryText && (
                <span className="nx-fd-chiprule is-removable">
                  <b>Anything</b>
                  <span className="nx-fd-chipop">contains</span>
                  <b className="nx-fd-mono">“{queryText}”</b>
                  <button type="button" aria-label="Remove the search term" onClick={() => set({ q: null, page: null })}>
                    <NxIcon name="close" size={11} />
                  </button>
                </span>
              )}
              {activeFilterCount > 0 && (
                <button type="button" className="nx-fd-link nx-fd-clear" onClick={clearQuestion}>
                  <ClearOutlined /> Clear
                </button>
              )}
            </>
          }
        />
      )}
    </>
  );
}

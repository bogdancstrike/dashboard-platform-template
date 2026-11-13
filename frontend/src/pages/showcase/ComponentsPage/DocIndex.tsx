
import { Input, Select } from "antd";
import { SearchOutlined } from "@ant-design/icons";

import { CollapseAllToggle } from "@/components/CollapseAllToggle";

import { ENTRIES, GROUPS } from "../docs/registry";

import { useComponentsPage } from "./useComponentsPage";

type Page = ReturnType<typeof useComponentsPage>;

/** The components by group, each a jump to its section; the one on screen is marked. */
export function DocIndex({ page }: { page: Page }) {
  const { term, setTerm, needle, active, shown, jump, folded, setFolded, toggleGroup } = page;
  return (
    <aside className="nx-doc-index" aria-label="Components">
      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder="Search components"
        aria-label="Search components"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
      />
      <Select
        className="nx-doc-jump"
        aria-label="Jump to a component"
        placeholder="Jump to…"
        showSearch
        optionFilterProp="label"
        value={null}
        onChange={(id: string) => jump(id)}
        options={GROUPS.map((group) => ({
          label: group,
          options: ENTRIES.filter((entry) => entry.group === group).map((entry) => ({ value: entry.id, label: entry.name })),
        }))}
      />
      <div className="nx-doc-navhead">
        <b>Components</b>
        <CollapseAllToggle
          label="groups"
          allCollapsed={folded.size === GROUPS.length}
          onToggle={(collapse) => setFolded(collapse ? new Set(GROUPS) : new Set())}
        />
      </div>
      <nav className="nx-doc-nav">
        {GROUPS.map((group) => {
          const items = shown.filter((entry) => entry.group === group);
          if (!items.length) return null;
          const isFolded = folded.has(group) && !needle;
          return (
            <div key={group} className="nx-doc-navgroup">
              <button
                type="button"
                className="nx-doc-navtoggle"
                aria-expanded={!isFolded}
                onClick={() => toggleGroup(group)}
              >
                {group}
                <span aria-hidden="true">{isFolded ? "+" : "–"}</span>
              </button>
              {!isFolded && items.map((entry) => (
                <a
                  key={entry.id}
                  href={`#doc-${entry.id}`}
                  aria-current={active === entry.id ? "location" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    jump(entry.id);
                  }}
                >
                  {entry.name}
                </a>
              ))}
            </div>
          );
        })}
        {!shown.length && <span className="nx-doc-muted">Nothing is called that.</span>}
      </nav>
    </aside>
  );
}

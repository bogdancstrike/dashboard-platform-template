/**
 * `/showcase/components` — the shared components, demonstrated live (§60).
 *
 * The failure mode of a component showcase is that it becomes a *second copy*
 * of the thing it documents: a hand-written gallery that drifts from the
 * components as they change, and is then worse than no gallery because
 * somebody trusts it. Three decisions keep this one honest.
 *
 * **The inventory is derived from the directory, not typed here.**
 * `import.meta.glob` enumerates `src/components/*.tsx` at build time, so a
 * component added to that directory appears on this page the same day and one
 * that is deleted stops being documented. Only the *demonstrations* are
 * written by hand, because a component cannot be rendered without knowing what
 * to pass it.
 *
 * **The page says what it is not showing.** Every component in the inventory
 * with no demonstration is listed as such, with its file, and the coverage is
 * a number at the top. A gallery that quietly omitted three components would be
 * a gallery nobody could rely on — the omission is the fact worth publishing.
 *
 * **The demonstrations are the real components in real states**, not
 * screenshots and not prose. Each one shows the states that are decisions —
 * `StatCard`'s polarity, because "up" is good for revenue and bad for
 * response time; `EmptyState`'s two shapes; `StatusTag` across the
 * vocabularies it colours — because those are what somebody reusing it needs
 * to see, and a single happy-path example teaches none of them.
 *
 * **Two shelves, and they promise different things.** The *shared toolkit*
 * (`components/*.tsx`) is what somebody building on the template reaches for,
 * and every one of them is either demonstrated here or listed as not. The
 * *feature components* (`components/mail`, `components/kanban`, …) belong to
 * their own features, so the page shows a chosen few — the ones whose shape is
 * worth borrowing — and says plainly that it is a selection rather than an
 * inventory. Claiming coverage of a hundred feature components would be a
 * promise this page could not keep.
 */

import { Alert, Input, Select, Table, Tag } from "antd";
import { AppstoreOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { CollapseAllToggle } from "@/components/CollapseAllToggle";

import { usePageCommands } from "@/commands/CommandContext";
import { PageHeader } from "@/components/PageHeader";
import { formatNumber } from "@/lib/formats";

import { CodeBlock } from "./docs/CodeBlock";
import { DemoFrame } from "./docs/DemoFrame";
import { DOCUMENTED_COMPONENTS, ENTRIES, GROUPS, searchText, type DocEntry, type PropDoc } from "./docs/registry";

/**
 * Every shared component file, from the directory itself.
 *
 * Only the *names* are wanted, never the modules — the page imports what it
 * demonstrates by hand — so nothing here is eager and the glob costs no
 * behaviour.
 *
 * **The test files are excluded in the pattern, and that is not a style
 * choice.** The first version globbed `*.tsx` and filtered the names
 * afterwards, which is too late: Vite builds a dynamic import for every match
 * *before* any filter runs, so `ExportButton.test.tsx` entered the production
 * module graph and dragged MSW in with it. The build then failed outright —
 * which was lucky, because the quiet version of that mistake is a bundle that
 * builds and ships the mock server. `docs/RBAC.md` promises test fixtures are
 * excluded from the runtime graph; a glob is exactly how that promise gets
 * broken, so the exclusion belongs where Vite reads it.
 */
const FILES = import.meta.glob(["../../components/*.tsx", "!../../components/*.test.tsx"]);

/** The component names the directory contains, derived and sorted. */
export function inventory(paths: string[] = Object.keys(FILES)): string[] {
  return paths
    .map((path) => path.split("/").pop() ?? "")
    // Belt and braces: the glob already excludes these, and this keeps
    // `inventory` honest when it is called with paths in a test.
    .filter((name) => name.endsWith(".tsx") && !name.includes(".test."))
    .map((name) => name.replace(/\.tsx$/, ""))
    .sort();
}

/**
 * Which shared components this page documents — derived from the registry,
 * and compared against the inventory so the gap is published, not hidden.
 */
const DEMONSTRATED: readonly string[] = DOCUMENTED_COMPONENTS;

/**
 * What the page can and cannot show, as one fact.
 *
 * Returned as a value so it can be asserted directly: the test that matters is
 * the one saying every component in the directory is either demonstrated or
 * *listed as not*, because that is the property a drifting gallery loses.
 */
export function coverage(
  names: string[] = inventory(),
  shown: readonly string[] = DEMONSTRATED,
): { shown: string[]; missing: string[]; total: number } {
  const set = new Set(shown);
  return {
    shown: names.filter((name) => set.has(name)),
    missing: names.filter((name) => !set.has(name)),
    total: names.length,
  };
}

const API_COLUMNS: ColumnsType<PropDoc> = [
  { title: "Prop", dataIndex: "name", width: 150, render: (name: string) => <code className="nx-doc-prop">{name}</code> },
  { title: "Type", dataIndex: "type", width: 230, render: (type: string) => <code className="nx-doc-type-cell">{type}</code> },
  { title: "Default", dataIndex: "default", width: 100, render: (value?: string) => (value ? <code>{value}</code> : "—") },
  { title: "Description", dataIndex: "description" },
];

/** Prose with `backticks` set as inline code. */
function prose(text: string) {
  return text.split(/(`[^`]+`)/).map((part, index) =>
    part.startsWith("`") && part.endsWith("`") ? <code key={index}>{part.slice(1, -1)}</code> : part,
  );
}

/** A component's documentation: what, when, how to import, the demos, the props. */
function DocSection({ entry, eager }: { entry: DocEntry; eager: boolean }) {
  return (
    <section id={`doc-${entry.id}`} className="nx-doc-section" data-testid={`demo-${entry.component ?? entry.id}`} aria-labelledby={`doc-${entry.id}-title`}>
      <header className="nx-doc-sechead">
        <h2 id={`doc-${entry.id}-title`}>{entry.name}</h2>
        <p>{prose(entry.purpose)}</p>
      </header>
      <div className="nx-doc-when">
        <b>When to use</b>
        <ul>
          {entry.when.map((line) => (
            <li key={line}>{prose(line)}</li>
          ))}
        </ul>
      </div>
      <CodeBlock code={entry.importLine} file="import" inline />
      {entry.demos.map((demo) => (
        <DemoFrame key={demo.id} id={demo.id} title={demo.title} note={demo.note} eager={eager} />
      ))}
      {entry.api && (
        <div className="nx-doc-api">
          <b>API</b>
          <Table<PropDoc> rowKey="name" size="small" columns={API_COLUMNS} dataSource={entry.api} pagination={false} scroll={{ x: 640 }} />
        </div>
      )}
    </section>
  );
}

export default function ComponentsPage() {
  const navigate = useNavigate();
  const found = useMemo(() => coverage(), []);
  // The search lives in the address, so a narrowed page can be shared.
  const [params, setParams] = useSearchParams();
  const term = params.get("q") ?? "";
  const setTerm = (value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set("q", value);
        else next.delete("q");
        return next;
      },
      { replace: true },
    );
  const [active, setActive] = useState(ENTRIES[0]!.id);
  const main = useRef<HTMLDivElement>(null);

  const needle = term.trim().toLowerCase();
  const shown = useMemo(
    () => (needle ? ENTRIES.filter((entry) => searchText(entry).includes(needle)) : ENTRIES),
    [needle],
  );
  const demoCount = ENTRIES.reduce((sum, entry) => sum + entry.demos.length, 0);

  // A component's section is a place: its anchor is pushed, so back returns
  // to the one before, and a link to `#doc-table` lands on the table.
  const location = useLocation();
  const jump = (id: string) => {
    setActive(id);
    navigate({ search: location.search, hash: `#doc-${id}` });
  };
  useEffect(() => {
    const id = location.hash.replace(/^#doc-/, "");
    if (!id || id === location.hash) return;
    setActive(id);
    document.getElementById(`doc-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash]);

  const [folded, setFolded] = useState<Set<string>>(new Set());
  const toggleGroup = (group: string) =>
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  // Which section is on screen, so the index can say where the reader is.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || !main.current) return;
    const observer = new IntersectionObserver(
      (records) => {
        const visible = records.filter((record) => record.isIntersecting);
        if (visible[0]) setActive(visible[0].target.id.replace(/^doc-/, ""));
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    main.current.querySelectorAll("section.nx-doc-section").forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [shown]);

  usePageCommands("showcase-components", [
    ...ENTRIES.map((entry) => ({
      id: `showcase.doc.${entry.id}`,
      label: `Docs: ${entry.name}`,
      keywords: `${entry.group} ${entry.purpose} component documentation`,
      run: () => jump(entry.id),
    })),
    {
      id: "showcase.templates",
      label: "See the page templates instead",
      icon: <AppstoreOutlined />,
      keywords: "templates layouts gallery pages shapes",
      run: () => navigate("/showcase/templates"),
    },
  ]);

  const missingColumns: ColumnsType<{ name: string }> = [
    { title: "Component", dataIndex: "name" },
    { title: "Where it is", dataIndex: "name", render: (name: string) => <code>src/components/{name}.tsx</code> },
  ];

  return (
    <div className="nx-ad nx-ad--components nx-doc">
      <PageHeader
        title={<>Component <em>docs</em></>}
        subtitle={`${ENTRIES.length} building blocks, ${demoCount} live demos — each with its code, copyable, and its props.`}
        tag={
          <Tag bordered={false}>
            {formatNumber(found.shown.length)} of {formatNumber(found.total)} demonstrated
          </Tag>
        }
        actions={<Link to="/showcase/templates">Page templates →</Link>}
      />

      {found.missing.length ? (
        <Alert
          type="warning"
          showIcon
          data-testid="coverage-gap"
          message={`${found.missing.length} shared ${found.missing.length === 1 ? "component has" : "components have"} no demonstration here`}
          description={
            <Table
              data-testid="missing-table"
              size="small"
              rowKey="name"
              pagination={false}
              dataSource={found.missing.map((name) => ({ name }))}
              columns={missingColumns}
            />
          }
        />
      ) : (
        <Alert
          type="success"
          showIcon
          data-testid="coverage-gap"
          message="Every shared component is demonstrated"
          description="The inventory is read from src/components; a component added there without a section here appears in this notice the same day."
        />
      )}

      <div className="nx-doc-layout">
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

        <div className="nx-doc-main" ref={main} data-testid="doc-sections">
          {GROUPS.map((group) => {
            const items = shown.filter((entry) => entry.group === group);
            if (!items.length) return null;
            return (
              <div key={group} className="nx-doc-groupblock">
                <h2 className="nx-doc-grouptitle">{group}</h2>
                {group === "Nucleus patterns" && (
                  // The tour points here by this literal id.
                  <p className="nx-doc-muted" data-testid="feature-shelf">
                    <span data-testid="feature-note">
                      A selection, not an inventory — feature components and compositions whose shape is worth
                      borrowing, each the real component with real props.
                    </span>
                  </p>
                )}
                {items.map((entry) => (
                  <DocSection key={entry.id} entry={entry} eager={shown.length <= 8} />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

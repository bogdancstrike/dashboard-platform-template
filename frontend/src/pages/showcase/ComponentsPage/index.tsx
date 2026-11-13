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

import { Alert, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/PageHeader";
import { formatNumber } from "@/lib/formats";

import { ENTRIES, GROUPS } from "../docs/registry";

import { DocIndex } from "./DocIndex";
import { DocSection } from "./DocSection";
import { useComponentsPage } from "./useComponentsPage";

export { coverage, inventory } from "./inventory";

export default function ComponentsPage() {
  const page = useComponentsPage();
  const { found, main, shown, demoCount } = page;
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
        <DocIndex page={page} />

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


import { Table } from "antd";
import type { ColumnsType } from "antd/es/table";

import { CodeBlock } from "../docs/CodeBlock";
import { DemoFrame } from "../docs/DemoFrame";
import { type DocEntry, type PropDoc } from "../docs/registry";

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
export function DocSection({ entry, eager }: { entry: DocEntry; eager: boolean }) {
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

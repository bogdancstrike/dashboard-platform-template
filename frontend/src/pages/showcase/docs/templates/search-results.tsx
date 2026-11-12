import { Card, Input } from "antd";
import { SearchOutlined } from "@ant-design/icons";

import { HighlightedText } from "@/components/HighlightedText";
import { PageHeader } from "@/components/PageHeader";

const RESULTS = [
  { kind: "Ticket", title: "Printer on fire in the north wing", ref: "TIC-00041" },
  { kind: "Task", title: "Replace the fire alarm panel", ref: "PLAT-00087" },
  { kind: "File", title: "fire-drill-2026.pdf", ref: "Facilities" },
];

export default function SearchResultsTemplate() {
  return (
    <div className="nx-ad">
      <PageHeader title={<>Global <em>search</em></>} subtitle="Every record type, ranked" />
      <div className="nx-ad-bar" role="search">
        <Input className="nx-ad-grow" prefix={<SearchOutlined />} defaultValue="fire" aria-label="Search everything" />
      </div>
      {RESULTS.map((result) => (
        <Card key={result.ref} size="small">
          <div className="nx-ad-main">
            <span><HighlightedText text={result.title} term="fire" /></span>
            <span>{result.kind} · {result.ref}</span>
          </div>
        </Card>
      ))}
    </div>
  );
}

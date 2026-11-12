import { Button, Card } from "antd";
import { PlusOutlined } from "@ant-design/icons";

import { PageHeader } from "@/components/PageHeader";

const LANES = [
  { name: "Backlog", cards: ["Self-service reporting", "Save a chart from the builder"] },
  { name: "In progress", cards: ["Export times out above 50 000 rows"] },
  { name: "Review", cards: ["Share a report with named colleagues", "Retire password sign-in"] },
];

export default function BoardTemplate() {
  return (
    <div className="nx-ad">
      <PageHeader title={<>Platform <em>delivery</em></>} subtitle="Columns you name, cards you drag" actions={<Button type="primary" icon={<PlusOutlined />}>New card</Button>} />
      <div className="nx-doc-board">
        {LANES.map((lane) => (
          <Card key={lane.name} size="small" title={`${lane.name} · ${lane.cards.length}`}>
            <div className="nx-doc-col">
              {lane.cards.map((card) => (
                <div key={card} className="nx-doc-kcard">{card}</div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

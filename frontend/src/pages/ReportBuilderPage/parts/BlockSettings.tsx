import { Button, Form, Input, Typography } from "antd";

import type { AnalysisCatalogue } from "@/api/analysis";
import type { DocumentBlock } from "@/api/reportDocuments";
import { BLOCK_SPECS } from "@/components/documents/blocks";

import { BLOCK_FIELDS, CAPTIONED } from "./blockFields";

const { Paragraph, Text } = Typography;

/** What one block shows. The kind decides which controls appear. */
export function BlockSettings({
  block,
  canEdit,
  datasets,
  reports,
  catalogue,
  onChange,
  onClose,
}: {
  block: DocumentBlock;
  canEdit: boolean;
  datasets: { key: string; label: string }[];
  reports: { id: string; name: string; visualization: string }[];
  catalogue?: AnalysisCatalogue;
  onChange: (patch: Partial<DocumentBlock>) => void;
  onClose: () => void;
}) {
  const spec = BLOCK_SPECS[block.kind];
  const Fields = BLOCK_FIELDS[block.kind];
  return (
    <div className="nu-doc-panel">
      <div className="nu-doc-panel-head">
        <Text strong>{spec.label}</Text>
        <Button type="text" onClick={onClose}>
          The page
        </Button>
      </div>
      <Paragraph type="secondary" className="nu-doc-panel-note">
        {spec.hint}
      </Paragraph>

      <Form layout="vertical" size="small" disabled={!canEdit}>
        {Fields && (
          <Fields
            block={block}
            onChange={onChange}
            datasets={datasets}
            reports={reports}
            catalogue={catalogue}
          />
        )}

        {CAPTIONED.has(block.kind) && (
          <Form.Item label="Caption" extra="A line above it, naming what it shows.">
            <Input
              value={block.caption}
              onChange={(event) => onChange({ caption: event.target.value })}
              aria-label="Caption"
            />
          </Form.Item>
        )}
      </Form>
    </div>
  );
}

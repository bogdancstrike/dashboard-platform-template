import { Form, Input, InputNumber, Segmented, Switch, Typography } from "antd";

import type { DocumentPage } from "@/api/reportDocuments";

const { Paragraph, Text } = Typography;

/** The paper, and the furniture printed on every page of it. */
export function PageSettings({
  page,
  canEdit,
  onChange,
}: {
  page: DocumentPage;
  canEdit: boolean;
  onChange: (next: DocumentPage) => void;
}) {
  const set = (patch: Partial<DocumentPage>) => onChange({ ...page, ...patch });
  return (
    <div className="nu-doc-panel">
      <Text strong>The page</Text>
      <Paragraph type="secondary" className="nu-doc-panel-note">
        Applies to every page of the export. Select a block to change what it shows.
      </Paragraph>
      <Form layout="vertical" size="small" disabled={!canEdit}>
        <Form.Item label="Paper">
          <Segmented
            block
            value={page.size}
            onChange={(value) => set({ size: value as DocumentPage["size"] })}
            options={[
              { value: "A4", label: "A4" },
              { value: "LETTER", label: "Letter" },
            ]}
          />
        </Form.Item>
        <Form.Item label="Orientation">
          <Segmented
            block
            value={page.orientation}
            onChange={(value) => set({ orientation: value as DocumentPage["orientation"] })}
            options={[
              { value: "portrait", label: "Portrait" },
              { value: "landscape", label: "Landscape" },
            ]}
          />
        </Form.Item>
        <Form.Item label="Margin" extra="Millimetres, on every side.">
          <InputNumber
            min={5}
            max={50}
            value={page.margin_mm}
            onChange={(value) => set({ margin_mm: Number(value ?? 20) })}
            style={{ width: "100%" }}
            aria-label="Margin"
          />
        </Form.Item>
        <Form.Item label="Running header" extra="Printed at the top of every page.">
          <Input
            value={page.header}
            onChange={(event) => set({ header: event.target.value })}
            placeholder="Acme · Confidential"
          />
        </Form.Item>
        <Form.Item label="Footer" extra="Printed at the bottom of every page.">
          <Input
            value={page.footer}
            onChange={(event) => set({ footer: event.target.value })}
            placeholder="Prepared for the board"
          />
        </Form.Item>
        <Form.Item label="Number the pages" valuePropName="checked">
          <Switch
            checked={page.page_numbers}
            onChange={(value) => set({ page_numbers: value })}
            aria-label="Number the pages"
          />
        </Form.Item>
        <Form.Item label="Title page" valuePropName="checked" extra="A cover, then a page break.">
          <Switch
            checked={page.cover}
            onChange={(value) => set({ cover: value })}
            aria-label="Title page"
          />
        </Form.Item>
        {page.cover && (
          <Form.Item label="Subtitle">
            <Input
              value={page.subtitle}
              onChange={(event) => set({ subtitle: event.target.value })}
              placeholder="Q3 · prepared 12 October"
            />
          </Form.Item>
        )}
        <Form.Item label="Accent" extra="Headings and table headers in the export.">
          <Input
            type="color"
            value={page.accent}
            onChange={(event) => set({ accent: event.target.value })}
            aria-label="Accent"
          />
        </Form.Item>
      </Form>
    </div>
  );
}

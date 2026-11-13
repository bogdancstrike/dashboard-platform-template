import { Alert, Form, Modal, Select } from "antd";
import { useState } from "react";

import type { AnalysisCatalogue } from "@/api/analysis";

/**
 * Have a first draft written, from one dataset (§28).
 *
 * Two questions, because two is what the server needs and a form that asked
 * for the title, the sections and the charts would be the builder again. What
 * comes back is a real document — a cover, a summary, the dataset's headline
 * numbers, a chart per declared grouping and a table of the newest rows — with
 * every block editable. The preview below the form says so in advance, because
 * "compose" with no statement of what it will produce is a button people press
 * once.
 */
export function ComposeDialog({
  open,
  catalogue,
  composing,
  onClose,
  onCompose,
}: {
  open: boolean;
  catalogue?: AnalysisCatalogue;
  composing: boolean;
  onClose: () => void;
  onCompose: (input: { entity: string; period?: string }) => void;
}) {
  const datasets = catalogue?.datasets ?? [];
  const [picked, setEntity] = useState("");
  const [period, setPeriod] = useState("");

  // Falls back to the first dataset rather than being seeded into state by an
  // effect: the catalogue can land after the dialog opens, and a select that is
  // empty until a second render is one somebody presses Compose against.
  const entity = picked || datasets[0]?.key || "";
  const chosen = datasets.find((item) => item.key === entity);

  return (
    <Modal
      open={open}
      title="Compose a report"
      okText="Compose it"
      onOk={() => onCompose({ entity, period: period || undefined })}
      okButtonProps={{ disabled: !entity, loading: composing }}
      onCancel={onClose}
      destroyOnHidden
    >
      <Form layout="vertical" size="small">
        <Form.Item label="About which dataset">
          <Select
            value={entity || undefined}
            onChange={setEntity}
            aria-label="Dataset"
            showSearch
            optionFilterProp="label"
            options={datasets.map((item) => ({ value: item.key, label: item.label }))}
            placeholder="Choose a dataset"
          />
        </Form.Item>
        <Form.Item label="Covering" extra="Every chart and table in it reads this window.">
          <Select
            value={period}
            onChange={setPeriod}
            aria-label="Period"
            options={[
              { value: "", label: "All time" },
              ...(catalogue?.periods ?? []).map((item) => ({
                value: item.key,
                label: item.label,
              })),
            ]}
          />
        </Form.Item>
      </Form>
      {chosen && (
        <Alert
          type="info"
          showIcon
          message={`A draft about ${chosen.label.toLowerCase()}`}
          description={
            <>
              A cover and a summary, {chosen.label.toLowerCase()} by the numbers,
              {chosen.default_date ? " a chart over time," : ""} up to three charts of its declared
              groupings, and a table of the newest rows. Every block is yours to edit or remove
              afterwards.
            </>
          }
        />
      )}
    </Modal>
  );
}

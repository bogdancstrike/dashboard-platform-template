import { Form, Select } from "antd";

import type { WidgetKind } from "@/api/dashboards";

import { FAMILY_LABELS, KINDS, KIND_FAMILIES, kindsOf, type KindSpec } from "../../kinds";

/** The kind, still changeable on the form: one dropdown, grouped by family. */
export function KindSelect({ kind, kinds }: { kind: WidgetKind; kinds: WidgetKind[] }) {
  return (
    <>
      {/* One dropdown, grouped by family. Twenty-six kinds as cards was five
            shelves and four hundred pixels before the first real question;
            each row here still carries the *question the kind answers*, which
            is what somebody choosing between "Bars" and "Share" needs. */}
      <Form.Item name="kind" label="What kind" extra={KINDS[kind].question}>
        <Select
          aria-label="Widget kind"
          showSearch
          optionFilterProp="label"
          listHeight={340}
          popupMatchSelectWidth={false}
          data-testid="widget-kind"
          options={KIND_FAMILIES.map((family) => ({
            label: FAMILY_LABELS[family].label,
            options: kindsOf(family, kinds).map((item) => ({
              value: item,
              label: KINDS[item].label,
              spec: KINDS[item],
            })),
          })).filter((group) => group.options.length > 0)}
          optionRender={(option) => {
            // The option as it was declared, which is the only place the
            // spec is: AntD types `data` as the *group* shape here because
            // the list is grouped, and the runtime value is the leaf.
            const data = option.data as unknown as { value: WidgetKind; spec: KindSpec };
            const spec = data.spec;
            return (
              <span className="nu-kindrow" data-testid={`kind-${data.value}`}>
                <span className="nu-kindrow-icon" style={{ color: spec.colour }}>
                  {spec.icon}
                </span>
                <span className="nu-kindrow-text">
                  <span className="nu-kindrow-label">{spec.label}</span>
                  <span className="nu-kindrow-question">{spec.question}</span>
                </span>
              </span>
            );
          }}
        />
      </Form.Item>
    </>
  );
}

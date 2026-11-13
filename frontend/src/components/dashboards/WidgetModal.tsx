/**
 * Choosing what a widget shows — with the widget drawn beside the form (§45).
 *
 * This was a 420-pixel drawer holding a form: pick "Heatmap · task · assignee
 * · last 30 days", press Add, and then find out what you made by hunting for
 * the card on the grid. Two problems, and they compound — somebody who does
 * not already know what a heatmap of a dataset looks like cannot choose one,
 * and every correction costs a round trip through a card they have to find
 * again.
 *
 * So it is a modal with two panes: the decision on the left, **the widget
 * itself on the right, drawn from live data**. Four decisions shape it.
 *
 * **The preview is the real card, not a picture of one.** It renders
 * `WidgetCard` around `WidgetBody` — the same two components the grid uses —
 * inside a box the height of the grid rows the widget will occupy. A preview
 * built out of different components is a preview that is wrong the first week
 * either changes, and "a table in a box" tells nobody what the card will look
 * like on the page.
 *
 * **The name comes first.** Title and note are the two fields somebody always
 * fills in, for every kind; the kind-specific controls appear underneath and
 * change as the kind does. A form whose first field moves depending on an
 * answer further down reads as a form that was assembled rather than designed.
 *
 * **The kinds are a dropdown, not a wall.** Twenty-six of them laid out as
 * cards was five shelves and four hundred pixels before the first real
 * question. Grouped in one select, with the icon and the *question the kind
 * answers* on each row, they cost one line and read better — the question is
 * what somebody choosing between "Bars" and "Share" actually needs.
 *
 * **The preview is debounced by React Query, not by a timer.** Every field
 * change re-renders it; the request key changes only when the *question* does,
 * so typing a title redraws and does not refetch.
 */

import { useQuery } from "@tanstack/react-query";
import { Form, Modal } from "antd";
import { useEffect, useState } from "react";

import { analysisApi } from "@/api/analysis";
import type { DashboardWidget, WidgetInput, WidgetKind } from "@/api/dashboards";
import type { ExplorerResource } from "@/api/explorer";
import { URL_OVERLAY } from "@/app/history";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";
import { STALE, queryKeys } from "@/lib/queryKeys";
import { useFeatures } from "@/settings/features";

import { KINDS, kindFlag } from "./kinds";
import { configFor, initialValues, type FormValues } from "./widgets/modal/configFor";
import { KindTiles } from "./widgets/modal/KindTiles";
import { ModalTitle } from "./widgets/modal/ModalTitle";
import { WidgetFields } from "./widgets/modal/WidgetFields";
import { WidgetPreview } from "./widgets/modal/WidgetPreview";

export function WidgetModal({
  open,
  widget,
  datasets,
  kinds,
  saving,
  period,
  resources,
  onClose,
  onSave,
  chosenKind,
  onChooseKind,
  onBackToKinds,
}: {
  /**
   * The kind chosen on the first step, when the page keeps the steps in its
   * address — so the browser's back goes from the form to the tiles, and from
   * the tiles out, one step at a time. Absent, the modal keeps them itself.
   */
  chosenKind?: WidgetKind | null;
  onChooseKind?: (kind: WidgetKind) => void;
  onBackToKinds?: () => void;
  open: boolean;
  widget: DashboardWidget | null;
  datasets: { key: string; label: string }[];
  kinds: WidgetKind[];
  saving: boolean;
  /** The dashboard's period, so the preview is drawn over what it will be. */
  period: string;
  resources: ExplorerResource[];
  onClose: () => void;
  onSave: (input: WidgetInput) => void;
}) {
  // Kinds whose feature is switched off are not offered (§27).
  const features = useFeatures();
  const offeredKinds = kinds.filter((item) => {
    const flag = kindFlag(item);
    return !flag || features(flag);
  });
  const [form] = Form.useForm();
  const [kind, setKind] = useState<WidgetKind>(widget?.kind ?? "KPI");
  /**
   * The form's values, mirrored so the preview can be built from them.
   *
   * `Form.useWatch` would need one call per field and would still miss the
   * ones a kind adds; keeping the whole object is simpler and is what the
   * preview needs anyway. It costs a render per keystroke, and the preview's
   * *query* key only changes when the question does — so typing a title
   * redraws and does not refetch.
   */
  const [values, setValues] = useState<FormValues>({});
  /**
   * A new widget starts on the canvas's grid of kinds: the first decision is
   * *what it shows*, and it is the one decision a reader recognises faster as
   * a picture than as a row in a dropdown. The form follows, with the kind
   * still changeable there.
   */
  const [pickingState, setPicking] = useState(widget === null);
  const controlled = onChooseKind !== undefined;
  const picking = controlled ? widget === null && !chosenKind : pickingState;
  useEffect(() => {
    if (open) {
      setPicking(widget === null);
      if (widget) setKind(widget.kind);
    }
  }, [open, widget]);
  useEffect(() => {
    if (chosenKind) setKind(chosenKind);
  }, [chosenKind]);
  // A widget's question is several choices — a dataset, a dimension, a
  // period — and closing the modal would take them all (§74).
  const { touch, requestClose } = useDiscardGuard({ close: onClose, what: "widget" });

  const catalogue = useQuery({
    queryKey: queryKeys.analysisCatalogue(),
    queryFn: ({ signal }) => analysisApi.catalogue(signal),
    staleTime: STALE.long,
  });

  const initial = initialValues(widget, kind, datasets);

  const dataset = catalogue.data?.datasets.find(
    (item) => item.key === (form.getFieldValue("entity") ?? initial.entity),
  );

  /**
   * The widget as it would be, for the preview.
   *
   * Built from the *same* `configFor` the save uses, so what is drawn is not
   * an approximation of what will be added — it is what will be added, minus
   * an id. Geometry is a plausible size for the kind rather than the one it
   * will get, because the preview pane is not the grid and pretending
   * otherwise would make a full-width card look wrong here and right there.
   */
  const draft: DashboardWidget = {
    id: widget?.id ?? "preview",
    kind,
    title: String(values["title"] ?? initial.title) || KINDS[kind].label,
    subtitle: (values["subtitle"] as string) || null,
    x: 0,
    y: 0,
    width: 6,
    height: 2,
    position: 0,
    config: configFor(kind, { ...initial, ...values }) ?? {},
  };

  // The size the server will actually give it, mirrored so the preview is the
  // shape the card will be rather than a rectangle chosen to look good here.

  const pickKind = (item: WidgetKind) => {
    setKind(item);
    setValues((current) => ({ ...current, kind: item }));
    if (onChooseKind) onChooseKind(item);
    else setPicking(false);
  };

  return (
    <Modal
      open={open}
      onCancel={requestClose}
      destroyOnHidden
      title={<ModalTitle widget={widget} kind={kind} picking={picking} />}
      className={`nu-widget-modal${picking ? " is-picking" : ""}`}
      rootClassName={controlled ? URL_OVERLAY : undefined}
      width={picking ? 760 : 940}
      okText={widget ? "Save" : "Add widget"}
      confirmLoading={saving}
      onOk={() => void form.submit()}
      okButtonProps={{ "data-testid": "save-widget" }}
      // Nothing to add until a kind is chosen, so the first step has only
      // the way out.
      footer={picking ? (_, { CancelBtn }) => <CancelBtn /> : undefined}
      cancelText={picking || widget ? "Cancel" : "Back"}
      cancelButtonProps={
        picking || widget
          ? undefined
          : {
              onClick: (event) => {
                event.stopPropagation();
                if (onBackToKinds) onBackToKinds();
                else setPicking(true);
              },
            }
      }
    >
      {picking ? (
        <KindTiles kinds={offeredKinds} current={kind} onPick={pickKind} />
      ) : (
        <div className="nu-widget-modal-panes">
          <div className="nu-widget-modal-form">
            <Form
              form={form}
              layout="vertical"
              initialValues={initial}
              onValuesChange={(changed: { kind?: WidgetKind }, all: FormValues) => {
                touch();
                setValues(all);
                if (changed.kind) setKind(changed.kind);
              }}
              onFinish={(values: FormValues) => {
                const chosen = (values["kind"] ?? "KPI") as WidgetKind;
                onSave({
                  kind: chosen,
                  title: String(values["title"] ?? ""),
                  subtitle: (values["subtitle"] as string) || null,
                  // The size a new widget gets comes from the server, which is the
                  // one place that knows a KPI wants three columns. An edited one
                  // keeps where the reader put it.
                  ...(widget ? {} : { x: 0 }),
                  config: configFor(chosen, values),
                });
              }}
            >
              <WidgetFields
                kind={kind}
                kinds={offeredKinds}
                datasets={datasets}
                dataset={dataset}
                periods={catalogue.data?.periods ?? []}
              />
            </Form>
          </div>

          <WidgetPreview
            draft={draft}
            period={period}
            catalogue={catalogue.data}
            resources={resources}
          />
        </div>
      )}
    </Modal>
  );
}

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Input, Modal, Radio, Skeleton, Space, Typography } from "antd";
import { GlobalOutlined, LockOutlined, TeamOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import { dashboardsApi, type SavedDashboard, type WidgetKind } from "@/api/dashboards";
import { EmptyState } from "@/components/EmptyState";
import { FailureAlert } from "@/components/FailureAlert";
import { KINDS } from "@/components/dashboards/kinds";

const { Text } = Typography;

/**
 * Putting something already saved onto a dashboard, from wherever it lives
 * (§45).
 *
 * The dashboard side of this was finished: a `REPORT` widget names a saved
 * report and runs *its* stored definition, so the picture is the one the chart
 * builder saved and not a copy of the question. What was missing was the
 * gesture. To reuse a chart a reader had to leave the chart, open
 * `/dashboards`, pick a dashboard, add a widget, choose "A saved report" and
 * find theirs in a select — six steps to say "and put that one there", which
 * is how people end up rebuilding the chart in the widget drawer instead. The
 * duplicate is then a second definition that drifts the first time either is
 * edited, which is the thing §45 exists to prevent.
 *
 * Deliberately a modal (§33): it asks one question — which dashboard — and a
 * drawer is for a form with parts. The new-dashboard option is here rather
 * than sending the reader to the wizard, because "there is nowhere to put it
 * yet" is the same decision, one field longer.
 */

/** What is being placed: the saved thing itself, never a copy of its question. */
export interface DashboardSubject {
  /** Which referencing kind draws it. */
  kind: Extract<WidgetKind, "REPORT" | "SEARCH">;
  id: string;
  /** What the card will be called — the saved thing's own name. */
  title: string;
}

/** The sentinel for "not one of the existing ones". Not a dashboard id. */
const NEW = "__new__";

const SCOPE_ICON = {
  PRIVATE: <LockOutlined />,
  SHARED: <TeamOutlined />,
  PUBLIC: <GlobalOutlined />,
} as const;

/** The config key each referencing kind reads. Declared once, in one place. */
const REFERENCE_KEY: Record<DashboardSubject["kind"], "report_id" | "search_id"> = {
  REPORT: "report_id",
  SEARCH: "search_id",
};

/** "alerts, revenue and a heatmap" — what a dashboard holds, in its own words. */
export function describeHolding(dashboard: SavedDashboard): string {
  if (dashboard.widget_count === 0) return "Empty so far";
  const kinds = [...new Set(dashboard.widget_kinds)].map((kind) => KINDS[kind].label.toLowerCase());
  const listed = kinds.slice(0, 3).join(", ");
  return kinds.length > 3 ? `${listed} and more` : listed;
}

export function AddToDashboard({
  open,
  subject,
  onClose,
}: {
  open: boolean;
  /** Absent while the modal is closed, so nothing is fetched for nothing. */
  subject: DashboardSubject | null;
  onClose: () => void;
}) {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<string>("");
  const [newName, setNewName] = useState("");

  const listing = useQuery({
    queryKey: ["dashboards"],
    queryFn: ({ signal }) => dashboardsApi.list(signal),
    enabled: open,
  });

  // Only the ones this reader may actually change. A dashboard shared *with*
  // them is readable and not writable, and offering it would be an option that
  // fails on the last press (§76).
  const mine = useMemo(
    () => (listing.data?.items ?? []).filter((item) => item.can_edit),
    [listing.data],
  );
  const canCreate = listing.data?.can_create ?? false;
  const creating = chosen === NEW;

  const add = useMutation({
    mutationFn: async () => {
      if (!subject) throw new Error("Nothing to add.");
      const widget = {
        kind: subject.kind,
        title: subject.title,
        config: { [REFERENCE_KEY[subject.kind]]: subject.id },
      };
      // One request either way, so a new dashboard is never left empty
      // because the second call failed.
      return creating
        ? dashboardsApi.create({ name: newName.trim() || subject.title, widgets: [widget] })
        : dashboardsApi.addWidget(chosen, widget);
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ["dashboards"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard", saved.id] });
      // A button carrying a closure rather than a `<Link>`: a toast is
      // portalled by `AntApp`, which sits *outside* the router, so a `<Link>`
      // rendered inside one has no routing context and throws. The closure
      // captured here does not need any.
      message.success({
        content: (
          <Text>
            Added to{" "}
            <button
              type="button"
              className="nu-link-button"
              onClick={() => {
                message.destroy();
                navigate(`/dashboards?dashboard=${saved.id}`);
              }}
            >
              {saved.name}
            </button>
          </Text>
        ),
        // Longer than the default three seconds: the offer to go and look at
        // it is only useful for as long as it is on screen.
        duration: 8,
      });
      close();
    },
  });

  const close = () => {
    setChosen("");
    setNewName("");
    add.reset();
    onClose();
  };

  const nothingToOffer = mine.length === 0 && !canCreate;

  return (
    <Modal
      open={open}
      onCancel={close}
      title={`Add ${subject?.title ?? "this"} to a dashboard`}
      okText={creating ? "Create and add" : "Add it"}
      okButtonProps={{
        disabled: !chosen,
        loading: add.isPending,
        "data-testid": "add-to-dashboard-confirm",
      }}
      onOk={() => add.mutate()}
      // The one refusal a reader cannot act on from here.
      footer={nothingToOffer ? null : undefined}
      destroyOnClose
    >
      {listing.isLoading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : listing.isError ? (
        <FailureAlert
          error={listing.error}
          titles={{
            forbidden: "Your role does not include dashboards",
            failed: "Your dashboards could not be listed",
          }}
          onRetry={() => void listing.refetch()}
        />
      ) : nothingToOffer ? (
        <EmptyState
          title="There is no dashboard you may change"
          hint="Creating one needs dashboards.manage. Anything shared with you is readable rather than writable."
        />
      ) : (
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          {add.error && (
            <FailureAlert
              error={add.error}
              titles={{
                forbidden: "Your role does not include changing this dashboard",
                not_found: "That dashboard has since been deleted",
                failed: "It could not be added",
              }}
            />
          )}

          <Radio.Group
            value={chosen}
            onChange={(event) => setChosen(String(event.target.value))}
            style={{ width: "100%" }}
          >
            <Space direction="vertical" size={4} style={{ width: "100%" }}>
              {mine.map((dashboard) => (
                <Radio key={dashboard.id} value={dashboard.id} className="nu-board-choice">
                  <span className="nu-board-choice-name">
                    <Text strong>{dashboard.name}</Text>
                    {dashboard.scope !== "PRIVATE" && (
                      <span aria-hidden="true">{SCOPE_ICON[dashboard.scope]}</span>
                    )}
                  </span>
                  {/* What it holds rather than how many: a reader recognises
                      "alerts, revenue and a heatmap" far faster than "7". */}
                  <Text type="secondary">{describeHolding(dashboard)}</Text>
                </Radio>
              ))}
              {canCreate && (
                <Radio value={NEW} className="nu-board-choice">
                  <Text strong>A new dashboard</Text>
                </Radio>
              )}
            </Space>
          </Radio.Group>

          {creating && (
            <Input
              autoFocus
              aria-label="New dashboard name"
              placeholder={subject?.title ?? "Dashboard name"}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onPressEnter={() => add.mutate()}
              maxLength={120}
            />
          )}
        </Space>
      )}
    </Modal>
  );
}


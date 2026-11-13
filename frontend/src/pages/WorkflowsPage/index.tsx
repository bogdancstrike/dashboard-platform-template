/**
 * `/workflows` — condition → action automation (§49).
 *
 * A table, filling the window, because the reader's question is comparative:
 * *what is watching what, and is any of it firing?* Cards would put four rules
 * on a screen and hide the column that answers it. The rule itself opens in a
 * drawer, so the list stays behind it — "is something else already watching
 * this?" is half of why a rule gets opened.
 *
 * Three decisions worth stating.
 *
 * **The loud column is the one that says whether it works.** Not the name and
 * not the schedule: a rule that has never fired and a rule that fired forty
 * times yesterday need completely different attention, and that is the fact
 * that goes next to the state. The tracker's ticket queue learned the same
 * lesson from the other direction — a column that is loud about something
 * every row shares says nothing at all.
 *
 * **"Paused" is a switch in the row, not a menu item.** Stopping a noisy
 * automation is the single most urgent thing anybody does on this page, and it
 * should never be three clicks deep.
 *
 * **The condition is shown as the server rendered it.** One line, ellipsised,
 * from `describe_tree` — so the sentence in the list is provably the shape of
 * the SQL the rule runs (§51), and not a summary the browser invented.
 */

import { Alert, Button, Card, Segmented, Skeleton, Table, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";

import type { AutomationRule } from "@/api/automations";
import { AutomationDrawer } from "@/components/automations/AutomationDrawer";
import { AutomationWizard } from "@/components/automations/AutomationWizard";
import { EmptyState } from "@/components/EmptyState";
import { NxIcon } from "@/components/NxIcon";
import { PageHeader } from "@/components/PageHeader";
import { apiMessage } from "@/lib/errors";

import { ruleColumns } from "./ruleColumns";
import { useWorkflowsPage } from "./useWorkflowsPage";

export { firingSummary } from "./ruleCopy";

export default function WorkflowsPage() {
  const page = useWorkflowsPage();
  const { state, open, set, creating, setCreating, catalogue, rules, refresh } = page;

  if (rules.isLoading || catalogue.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (rules.isError || catalogue.isError) {
    const error = rules.error ?? catalogue.error;
    return (
      <>
        <PageHeader title="Automations" />
        <Alert
          type="error"
          showIcon
          message={apiMessage(error, "Automations could not be loaded.")}
          action={
            <Button onClick={() => void rules.refetch()}>
              Retry
            </Button>
          }
        />
      </>
    );
  }

  const rows = rules.data?.items ?? [];
  const counts = rules.data?.counts;

  return (
    <>
      <PageHeader
        title="Automations"
        subtitle="When records look like this, do these things — on the same conditions the advanced search builds."
        tag={
          counts ? (
            <Tag color={counts.enabled > 0 ? "blue" : undefined}>
              {counts.enabled} of {counts.total} live
            </Tag>
          ) : undefined
        }
        actions={<RuleActions page={page} />}
      />

      {rows.length === 0 && !state ? (
        <EmptyState
          guide="workflow"
          title="Nothing is watching anything yet"
          hint="An automation is one sentence: when records look like this, notify somebody, raise a task, or call a webhook. It is created paused, and rehearsed before it fires."
          action={
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              Write the first one
            </Button>
          }
        />
      ) : (
        // Filling the window rather than ending where the rows do (§20).
        <RuleList page={page} />
      )}

      {catalogue.data && (
        <AutomationWizard
          open={creating}
          catalogue={catalogue.data}
          onClose={() => setCreating(false)}
          onCreated={(rule) => {
            setCreating(false);
            refresh();
            // Straight into the drawer: it was created paused, and switching
            // it on is the next thing the reader wants to do.
            set({ rule: rule.id });
          }}
        />
      )}

      {catalogue.data && (
        <AutomationDrawer
          ruleId={open}
          catalogue={catalogue.data}
          onClose={() => set({ rule: null })}
          onChanged={refresh}
        />
      )}
    </>
  );
}

type Page = ReturnType<typeof useWorkflowsPage>;

/** Build on the canvas, where it is switched on, and write one. */
function RuleActions({ page }: { page: Page }) {
  const { canvasOn, build, setCreating } = page;
  return (
    <>
      {canvasOn && (
        <Button
          icon={<NxIcon name="flow" size={16} />}
          onClick={() => build.mutate()}
          loading={build.isPending}
          data-testid="build-on-canvas"
        >
          Build on canvas
        </Button>
      )}
      <Button
        type="primary"
        icon={<PlusOutlined />}
        onClick={() => setCreating(true)}
        data-testid="new-automation"
      >
        Write one
      </Button>
    </>
  );
}

/** The automations, filling the window rather than ending where the rows do (§20). */
function RuleList({ page }: { page: Page }) {
  const { state, set, rules } = page;
  const rows = rules.data?.items ?? [];
  const counts = rules.data?.counts;
  return (
    <div className="nu-fill">
      <Card
        size="small"
        className="nu-pane nu-pane--table"
        data-testid="automation-list"
        title={
          <Segmented
            aria-label="State"
            value={state || "all"}
            onChange={(next) => set({ state: next === "all" ? null : String(next) })}
            options={[
              { value: "all", label: `Everything (${counts?.total ?? 0})` },
              { value: "ENABLED", label: `Live (${counts?.enabled ?? 0})` },
              { value: "PAUSED", label: "Paused" },
            ]}
          />
        }
      >
        <Table<AutomationRule>
          className="nx-rec-table"
          rowKey="id"
          size="small"
          sticky
          columns={ruleColumns(page)}
          dataSource={rows}
          pagination={false}
          locale={{
            emptyText: (
              <EmptyState compact title="Nothing in this state" />
            ),
          }}
        />
      </Card>
    </div>
  );
}

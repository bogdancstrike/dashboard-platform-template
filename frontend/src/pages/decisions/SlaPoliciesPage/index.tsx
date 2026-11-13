import "@/styles/decisions.css";

import { Alert, Button, Skeleton, Space, Typography } from "antd";

import { TdIcon } from "@/components/icons/TdIcon";
import { NxIcon } from "@/components/NxIcon";
import { PageHeader } from "@/components/PageHeader";
import { errorText } from "@/lib/errors";

import { CalendarCard } from "./CalendarCard";
import { CalendarModal } from "./CalendarModal";
import { PolicyCard } from "./PolicyCard";
import { PolicyDrawer } from "./PolicyDrawer";
import { useSlaPage } from "./useSlaPage";

const { Text } = Typography;

/**
 * SLA policies: which tickets, what targets, whose hours, what happens when a
 * ticket is running late. Saving any of it recomputes every ticket's clock,
 * so the ticket pages and every report agree the moment it is saved.
 */
export default function SlaPoliciesPage() {
  const page = useSlaPage();
  const { tab, policyOverlay, overview, catalogue, apply, canManage, setCalendar, refresh } = page;

  if (overview.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;
  if (overview.isError || !overview.data) {
    return <Alert type="error" showIcon message={errorText(overview.error, { fallback: "The policies could not be read." })} />;
  }
  const data = overview.data;
  const covered = data.items.reduce((sum, item) => sum + item.covered_open, 0);
  const breached = data.items.reduce((sum, item) => sum + item.breached_open, 0);

  return (
    <div className="nx-td" data-testid="sla-page">
      <PageHeader
        title={<>SLA <em>policies</em></>}
        subtitle={`${data.items.length} policies · ${covered} open tickets covered · ${breached} breached · ${data.uncovered_open} without a policy`}
        actions={canManage ? (
          <Space wrap>
            <Button icon={<TdIcon name="clock" />} loading={apply.isPending} onClick={() => apply.mutate()}>Apply now</Button>
            <Button type="primary" icon={<NxIcon name="plus" />} onClick={() => (tab === "calendars" ? setCalendar({}) : policyOverlay.open("new"))} data-testid="sla-new">
              {tab === "calendars" ? "New calendar" : "New policy"}
            </Button>
          </Space>
        ) : undefined}
      />
      <div className="nx-td-chips" role="tablist" aria-label="SLA views">
        {(["policies", "calendars"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`nx-td-chip${tab === key ? " is-on" : ""}`}
            onClick={() => page.setParams(key === "policies" ? {} : { tab: key })}
          >
            {key === "policies" ? "Policies" : "Business calendars"}
            <b>{key === "policies" ? data.items.length : data.calendars.length}</b>
          </button>
        ))}
      </div>

      {tab === "policies" ? (
        <>
          <Text type="secondary">The first active policy whose conditions match a ticket sets its clock. Order matters — put the narrow ones first.</Text>
          {data.items.length === 0 && <div className="nx-td-empty">No policies — tickets keep whatever deadline they were given.</div>}
          {data.items.map((policy, index) => (
            <PolicyCard
              key={policy.id}
              policy={policy}
              index={index}
              count={data.items.length}
              catalogue={catalogue.data}
              canManage={canManage}
              onToggle={() => page.toggle.mutate(policy)}
              onMove={(delta) => page.move(index, delta)}
              onEdit={() => policyOverlay.open(policy.id)}
            />
          ))}
        </>
      ) : (
        <div className="nx-td-list">
          {data.calendars.map((cal) => (
            <CalendarCard key={cal.id} cal={cal} canManage={canManage} onEdit={() => setCalendar(cal)} onRemoved={refresh} />
          ))}
        </div>
      )}

      {catalogue.data && (
        <PolicyDrawer
          id={policyOverlay.value}
          onClose={policyOverlay.close}
          policies={data.items}
          calendars={data.calendars}
          catalogue={catalogue.data}
          onSaved={refresh}
        />
      )}
      {catalogue.data && (
        <CalendarModal calendar={page.calendar} catalogue={catalogue.data} onClose={() => setCalendar(null)} onSaved={refresh} />
      )}
    </div>
  );
}

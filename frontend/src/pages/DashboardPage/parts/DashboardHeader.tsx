import { Segmented, Select } from "antd";

import { AutoRefresh } from "@/components/AutoRefresh";
import { PageHeader } from "@/components/PageHeader";

import type { DashboardPageData } from "../useDashboardPage";

/** The title, how fresh the numbers are, and the period they cover. */
export function DashboardHeader({ page }: { page: DashboardPageData }) {
  const { screens, period, data, refetch, dataUpdatedAt, isFetching, periodOptions, choosePeriod } =
    page;
  return (
    <>
      <PageHeader
        title={
          <span>
            Organisation <em>dashboard</em>
          </span>
        }
        subtitle={
          data
            ? `${new Date(data.period.from).toLocaleDateString()} — ${new Date(
                data.period.to,
              ).toLocaleDateString()} · compared with the previous period of equal length`
            : "Loading the overview…"
        }
      />

      {/* The toolbar under the title, as on the canvas: how fresh the
          numbers are, and the window they cover. */}
      <div className="nx-ov-dashbar">
        {/* The page people leave open all day, so it says how old its
            numbers are and offers to keep them current (§53). The cache is
            invalidated by writes, so this is for the writes that happen
            *elsewhere* — somebody else closing a ticket. */}
        <AutoRefresh
          page="dashboard"
          updatedAt={dataUpdatedAt}
          busy={isFetching}
          refresh={() => void refetch()}
        />
        {periodOptions.length > 0 &&
          (screens.md !== false ? (
            <Segmented
              size="middle"
              value={period}
              onChange={choosePeriod}
              options={periodOptions.map((option) => ({
                label: option.label,
                value: option.key,
              }))}
            />
          ) : (
            <Select
              aria-label="Dashboard period"
              value={period}
              onChange={choosePeriod}
              style={{ minWidth: 170 }}
              options={periodOptions.map((option) => ({
                label: option.label,
                value: option.key,
              }))}
            />
          ))}
      </div>
    </>
  );
}

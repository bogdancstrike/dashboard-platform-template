import { Segmented, Skeleton } from "antd";

import { EmptyState } from "@/components/EmptyState";

import { InsightCard } from "../parts/InsightCard";
import type { InsightsPageData } from "../useInsightsPage";

/** The saved insights, by scope. */
export function InsightGallery({ page }: { page: InsightsPageData }) {
  const { filter, setFilter, openId, list, openSaved, items, busy, current } = page;
  return (
    <>
      {!busy && !current && !openId && (
        <section className="nx-in-gallery" data-testid="insight-gallery">
          <div className="nx-in-gallery-bar">
            <h2 className="nx-in-gallery-title">Saved insights</h2>
            <Segmented
              value={filter}
              onChange={(value) => setFilter(value as "all" | "mine")}
              options={[
                { value: "all", label: "All I can see" },
                { value: "mine", label: "Mine" },
              ]}
            />
          </div>
          {list.isLoading && <Skeleton active />}
          {!list.isLoading && !items.length && (
            <EmptyState
              title="No saved insights yet"
              hint="Ask a question above, or press a suggestion — then save the page you want to keep."
            />
          )}
          <div className="nx-in-cards">
            {items.map((item) => (
              <InsightCard key={item.id} item={item} onOpen={() => openSaved(item.id)} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

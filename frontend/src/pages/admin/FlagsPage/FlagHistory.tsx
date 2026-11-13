import { useQuery } from "@tanstack/react-query";
import { Skeleton, Timeline, Typography } from "antd";

import { settingsApi, type FeatureFlag } from "@/api/settings";
import { EmptyState } from "@/components/EmptyState";
import { absoluteTime, relativeTime } from "@/lib/time";
import { queryKeys } from "@/lib/queryKeys";

const { Text } = Typography;

/** Who changed the flag, when, and which fields. */
export function FlagHistory({ flag, open }: { flag: FeatureFlag | undefined; open: boolean }) {
  const history = useQuery({
    queryKey: queryKeys.adminFlags("history", flag?.key),
    queryFn: ({ signal }) => settingsApi.flagHistory(flag!.key, signal),
    enabled: open && Boolean(flag),
  });
  if (history.isLoading) return <Skeleton active />;
  if ((history.data?.items ?? []).length === 0) return <EmptyState compact title="Never changed by hand" />;
  return (
    <Timeline
      data-testid="flag-history"
      items={(history.data?.items ?? []).map((entry) => ({
        children: (
          <div className="nx-ff-history">
            <Text strong>{entry.actor ?? "Somebody"}</Text> <Text>{entry.message}</Text>
            <div>
              <Text type="secondary">{entry.at ? `${relativeTime(entry.at)} · ${absoluteTime(entry.at)}` : ""}</Text>
            </div>
            {entry.changed_fields.length > 0 && (
              <Text type="secondary" className="nu-mono">
                {entry.changed_fields.join(", ")}
              </Text>
            )}
          </div>
        ),
      }))}
    />
  );
}

/**
 * The daily brief on Home (§45): the AI version of "what is waiting on you".
 *
 * The strip above it counts; this ranks and explains — by urgency first, then
 * by how this person usually works — with a reason each and a link to the
 * rows. The server writes it once a day and keeps it; Refresh writes it again.
 * When no model answered, the same items arrive ranked by rule and the card
 * says so, rather than pretending.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Skeleton, Tooltip } from "antd";
import { Link } from "react-router-dom";

import { assistantApi, type Brief } from "@/api/assistant";
import { ApiError } from "@/api/client";
import { useAuth } from "@/auth/AuthProvider";
import { relativeTime } from "@/lib/time";

import { AstIcon } from "@/components/icons/AstIcon";
import "@/styles/assistant.css";
import { FEATURES, withFeature } from "@/settings/features";
import { STALE, queryKeys } from "@/lib/queryKeys";

const URGENCY = { high: "Now", medium: "Today", low: "When you can" } as const;

function DailyBriefInner() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = can("ai.use");
  const brief = useQuery({
    queryKey: queryKeys.assistantBrief(),
    queryFn: ({ signal }) => assistantApi.brief(signal),
    enabled,
    staleTime: STALE.long,
  });
  if (!enabled) return null;

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const fresh = await assistantApi.refreshBrief();
      queryClient.setQueryData<Brief>(queryKeys.assistantBrief(), fresh);
    } catch (failure) {
      setError(failure instanceof ApiError || failure instanceof Error ? failure.message : "Could not refresh the brief.");
    } finally {
      setRefreshing(false);
    }
  };

  const data = brief.data;
  return (
    <Card
      size="small"
      className="nx-ai-brief"
      data-testid="daily-brief"
      title={
        <span className="nx-ai-brief-title">
          <AstIcon name="spark" size={15} /> Your brief
        </span>
      }
      extra={
        <Tooltip title={data ? `Written ${relativeTime(data.generated_at)}` : "Write it again"}>
          <Button loading={refreshing} onClick={() => void refresh()} data-testid="brief-refresh" icon={<AstIcon name="retry" />}>
            Refresh
          </Button>
        </Tooltip>
      }
    >
      {brief.isLoading && <Skeleton active paragraph={{ rows: 3 }} title={false} />}
      {brief.isError && <Alert type="warning" showIcon message="The brief could not be written just now." />}
      {error && <Alert type="error" showIcon message={error} className="nx-ai-brief-error" />}
      {data && (
        <>
          <p className="nx-ai-brief-headline" data-testid="brief-headline">{data.headline}</p>
          {data.items.length > 0 && (
            <ol className="nx-ai-brief-list">
              {data.items.map((item) => (
                <li key={item.key} className={`nx-ai-brief-item is-${item.urgency}`} data-testid={`brief-item-${item.key}`}>
                  <span className={`nx-ai-urgency nx-ai-urgency--${item.urgency}`}>{URGENCY[item.urgency]}</span>
                  <div className="nx-ai-brief-body">
                    <Link to={item.link} className="nx-ai-brief-link">
                      {item.title}
                    </Link>
                    <span className="nx-ai-brief-reason">{item.reason}</span>
                    {item.examples.length > 0 && (
                      <span className="nx-ai-brief-examples">
                        {item.examples.slice(0, 2).map((example) => (
                          <Link key={example.link + example.label} to={example.link}>
                            {example.label}
                          </Link>
                        ))}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
          <p className="nx-ai-brief-source">
            {data.source === "ai" ? "Ranked by the assistant from what is waiting and how you usually work." : "Ranked by rule — the AI model was not available."}
          </p>
        </>
      )}
    </Card>
  );
}

/** Rendered only while its feature flag is on (§27). */
export const DailyBrief = withFeature(FEATURES.aiDailyBrief, DailyBriefInner);

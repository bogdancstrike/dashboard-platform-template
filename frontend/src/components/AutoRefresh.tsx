import { Dropdown, Tooltip, Typography } from "antd";
import { DownOutlined, ReloadOutlined } from "@ant-design/icons";

import {
  REFRESH_CHOICES,
  refreshLabel,
  useAutoRefresh,
  type RefreshSeconds,
} from "@/hooks/useAutoRefresh";
import { relativeTime } from "@/lib/time";

const { Text } = Typography;

/**
 * "Refreshed a minute ago", and how often to do it again (§53).
 *
 * Two halves of one honesty. A page that quietly goes out of date while
 * somebody reads it should say *how* out of date — a reader deciding whether
 * to act on a number needs to know it is nine minutes old — and if they are
 * going to sit on the page, they should be able to say how often it is
 * re-asked rather than have a number chosen for them.
 *
 * The refresh itself is deliberately a *refetch*, not a remount: react-query
 * keeps the current answer on screen while the new one is in flight, so
 * nothing blanks, the scroll stays and a selection survives. An auto-refresh
 * that moves the page under the reader is worse than none.
 */
export function AutoRefresh({
  page,
  refresh,
  updatedAt,
  busy = false,
  defaultSeconds = 0,
}: {
  /** The page's own key — the choice is remembered per page. */
  page: string;
  refresh: () => void;
  /** When the data on screen came back, from the query itself. */
  updatedAt?: number;
  busy?: boolean;
  /** Where this page starts: off, unless watching it is the job. */
  defaultSeconds?: RefreshSeconds;
}) {
  const { seconds, choose, paused } = useAutoRefresh({ page, refresh, defaultSeconds });

  return (
    <span className="nu-refresh" data-testid="auto-refresh">
      {updatedAt ? (
        // The age of what is on screen, not the time of the request: those
        // differ by exactly the amount that matters when a page is stale.
        <Text type="secondary" className="nu-refresh-age" data-testid="refreshed-at">
          {busy ? "Refreshing…" : `Refreshed ${relativeTime(new Date(updatedAt).toISOString())}`}
        </Text>
      ) : null}
      {/* A split control, because the two things a reader wants here are
          different sizes: "reload it now" is one press, and "keep reloading it
          every minute" is a decision made once. One button doing both would
          open a menu every time somebody just wanted the current numbers. */}
      <Dropdown.Button
        icon={<DownOutlined />}
        onClick={refresh}
        buttonsRender={([main, arrow]) => [
          <Tooltip key="now" title="Read it again now">
            {main}
          </Tooltip>,
          <Tooltip
            key="how-often"
            title={
              seconds === 0
                ? "Choose how often this page re-asks"
                : paused
                  ? `Every ${refreshLabel(seconds)} — parked while this tab is in the background`
                  : `Refreshing every ${refreshLabel(seconds)}`
            }
          >
            {arrow}
          </Tooltip>,
        ]}
        menu={{
          selectable: true,
          selectedKeys: [String(seconds)],
          items: REFRESH_CHOICES.map((choice) => ({
            key: String(choice),
            label: choice === 0 ? "Off" : `Every ${refreshLabel(choice)}`,
          })),
          onClick: ({ key }) => choose(Number(key) as RefreshSeconds),
        }}
      >
        <span data-testid="refresh-now">
          <ReloadOutlined spin={busy} />{" "}
          {seconds === 0 ? "Refresh" : refreshLabel(seconds)}
        </span>
      </Dropdown.Button>
    </span>
  );
}

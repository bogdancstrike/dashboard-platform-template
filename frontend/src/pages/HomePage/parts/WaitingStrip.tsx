import { Alert, Skeleton } from "antd";
import { Link } from "react-router-dom";

import type { HomePageData } from "../useHomePage";

/** Only what is actually waiting, each one a link to the rows it counted. */
export function WaitingStrip({ page }: { page: HomePageData }) {
  const { settling, waiting } = page;
  return (
    <section
      aria-label="Waiting for you"
      data-testid="waiting"
      // Published so a test can wait for the answer rather than sample the
      // strip mid-flight and believe whichever branch it caught — which is
      // how the flake that found this read an empty strip and then waited
      // fifteen seconds for a sentence the data had already ruled out.
      data-settled={settling ? "no" : "yes"}
    >
      {settling ? (
        <Skeleton active paragraph={{ rows: 1 }} title={false} />
      ) : waiting.length === 0 ? (
        <Alert
          type="success"
          showIcon
          message="Nothing is waiting for you"
          description="No unanswered invitations, no unread mail, nothing past its due date. The numbers are on the dashboard when you want them."
        />
      ) : (
        <div className="nu-home-waiting">
          {waiting.map((item) => (
            <Link
              key={item.key}
              to={item.to}
              className="nu-waitcard"
              data-testid={`waiting-${item.key}`}
            >
              <span className="nu-waitcard-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="nu-waitcard-count">{item.count}</span>
              <span className="nu-waitcard-label">{item.label}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}


import { Typography } from "antd";
import { useState } from "react";
import { Link } from "react-router-dom";

import { StatusTag } from "@/components/StatusTag";

import { PREVIEW_ROWS } from "./templateCopy";

const { Text, Paragraph } = Typography;

/**
 * The split view, in miniature (§62).
 *
 * A demonstration rather than a picture: the list on the left keeps its own
 * selection and scroll while the right pane changes, which is the whole claim
 * of the layout and the one thing a screenshot cannot show. Three rows is
 * enough — this is a shape, not a dataset.
 */
export function SplitPreview() {
  const [chosen, setChosen] = useState(PREVIEW_ROWS[0]!.reference);
  const row = PREVIEW_ROWS.find((item) => item.reference === chosen) ?? PREVIEW_ROWS[0]!;

  return (
    <div className="nu-tmpl-preview" data-testid="split-preview">
      <ul className="nu-tmpl-preview-list">
        {PREVIEW_ROWS.map((item) => (
          <li key={item.reference}>
            <button
              type="button"
              className={`nu-tmpl-preview-row${
                item.reference === chosen ? " is-active" : ""
              }`}
              onClick={() => setChosen(item.reference)}
              aria-current={item.reference === chosen}
            >
              <span className="nu-tmpl-preview-ref">{item.reference}</span>
              <span className="nu-tmpl-preview-title">{item.title}</span>
              <StatusTag status={item.status} />
            </button>
          </li>
        ))}
      </ul>
      <div className="nu-tmpl-preview-detail" data-testid="split-preview-detail">
        <Text strong>{row.title}</Text>
        <Text type="secondary">
          {row.reference} · {row.who}
        </Text>
        <Paragraph type="secondary" className="nu-tmpl-preview-body">
          {row.body}
        </Paragraph>
        <Text type="secondary">
          The list keeps its place. On <Link to="/mail">/mail</Link> and{" "}
          <Link to="/tickets">/tickets</Link> the panes are addressable, so a
          selected item is a link somebody can send.
        </Text>
      </div>
    </div>
  );
}

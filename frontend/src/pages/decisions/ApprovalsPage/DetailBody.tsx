import { Space, Typography } from "antd";
import { Link } from "react-router-dom";

import { age, type ApprovalDetail } from "@/api/approvals";
import { PersonAvatar } from "@/components/PersonAvatar";
import { absoluteTime, relativeTime } from "@/lib/time";

import { KindIcon, Standing } from "./approvalKinds";
import { DETAIL_SECTIONS, FactRow } from "./detailSections";

const { Text, Paragraph } = Typography;

/** One request in full: who asked, about what, what its provider sent, and its history. */
export function DetailBody({ item }: { item: ApprovalDetail }) {
  const details = item.details;
  return (
    <Space direction="vertical" size={18} style={{ width: "100%" }}>
      <div className="nx-td-policy-head">
        <span className="nx-td-row-icon"><KindIcon icon={item.icon} /></span>
        <div style={{ minWidth: 0 }}>
          <h3 className="nx-td-policy-title" data-testid="approval-title">{item.title}</h3>
          <Space size={6} wrap style={{ marginTop: 4 }}>
            <Standing item={item} />
            <span className="nx-td-pilltag nx-td-pilltag--plain">{item.kind_label}</span>
          </Space>
        </div>
      </div>
      {item.summary && <Paragraph className="nx-td-quote">{item.summary}</Paragraph>}
      <Facts item={item} />
      {DETAIL_SECTIONS.map(({ key, Section }) => (
        <Section key={key} details={details} />
      ))}
      <History item={item} />
    </Space>
  );
}

function Facts({ item }: { item: ApprovalDetail }) {
  return (
    <dl className="nx-td-facts">
      <dt>Requested by</dt>
      <dd>
        <Space size={6}>
          <PersonAvatar name={item.requester?.name} src={item.requester?.avatar_url} size={22} />
          {item.requester?.name ?? "—"}
        </Space>
      </dd>
      <dt>Asked</dt><dd>{absoluteTime(item.created_at)} ({age(item.age_hours)} ago)</dd>
      <dt>Answer due</dt><dd>{absoluteTime(item.due_at)}</dd>
      {item.assignee && (<><dt>Routed to</dt><dd>{item.assignee.name}</dd></>)}
      {item.subject_label && (
        <>
          <dt>About</dt>
          <dd>{item.link ? <Link to={item.link}>{item.subject_label}</Link> : item.subject_label}</dd>
        </>
      )}
      {(item.details.facts ?? []).map((fact) => (
        <FactRow key={fact.label} label={fact.label} value={fact.value} />
      ))}
    </dl>
  );
}

function History({ item }: { item: ApprovalDetail }) {
  return (
    <div>
      <p className="nx-td-section">History</p>
      <ol className="nx-td-history" data-testid="approval-history">
        {item.history.map((event, index) => (
          <li key={`${event.at}-${index}`} className={`is-${event.action}`}>
            <div>
              <Text strong>{event.actor_label || "Somebody"}</Text>{" "}
              <Text type="secondary">{event.action.toLowerCase()} · {relativeTime(event.at)}</Text>
              {event.comment && <p className="nx-td-quote">{event.comment}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

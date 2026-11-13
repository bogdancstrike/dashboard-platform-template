
import { Button, Tag } from "antd";
import { Link } from "react-router-dom";

import { TEMPLATES } from "../docs/sources";
import { type StarterTemplate } from "../docs/templateRegistry";

/** A starter template's live thumbnail: the real page, drawn small and inert. */
export function Thumb({ id }: { id: string }) {
  const Page = TEMPLATES[id]?.default;
  return (
    // `inert` by attribute: React 18 has no prop for it, and a thumbnail must
    // not put a whole page of controls into the tab order.
    <div className="nx-tpl-thumb" aria-hidden="true" ref={(node) => node?.setAttribute("inert", "")}>
      <div className="nx-tpl-thumb-page">{Page ? <Page /> : null}</div>
    </div>
  );
}

/** One starter: thumbnail, when to use it, and its code a click away. */
export function StarterCard({ starter, onOpen }: { starter: StarterTemplate; onOpen: () => void }) {
  return (
    <article className="nx-tpl-card" data-testid={`starter-${starter.id}`}>
      <button type="button" className="nx-tpl-preview" onClick={onOpen} aria-label={`Open the ${starter.name} template`}>
        <Thumb id={starter.id} />
      </button>
      <div className="nx-tpl-body">
        <b>{starter.name}</b>
        <span>{starter.when}</span>
        <span className="nx-tpl-pieces">
          {starter.pieces.map((piece) => (
            <Tag key={piece} bordered={false}>
              {piece}
            </Tag>
          ))}
        </span>
        <span className="nx-tpl-actions">
          <Button onClick={onOpen}>View code</Button>
          {starter.example && <Link to={starter.example}>See it live →</Link>}
        </span>
      </div>
    </article>
  );
}

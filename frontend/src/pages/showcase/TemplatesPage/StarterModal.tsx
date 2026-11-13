
import { Modal, Segmented } from "antd";
import { useState } from "react";

import { CodeBlock } from "../docs/CodeBlock";
import { Stage } from "../docs/DemoFrame";
import { TEMPLATES, TEMPLATE_SOURCE } from "../docs/sources";
import { type StarterTemplate } from "../docs/templateRegistry";
import { URL_OVERLAY } from "@/app/history";

/** The template, full size, with its source and a copy. */
export function StarterModal({ starter, onClose }: { starter: StarterTemplate | null; onClose: () => void }) {
  const [view, setView] = useState<"preview" | "code">("preview");
  const Page = starter ? TEMPLATES[starter.id]?.default : undefined;
  return (
    <Modal
      open={starter !== null}
      onCancel={() => {
        setView("preview");
        onClose();
      }}
      footer={null}
      width={1180}
      rootClassName={URL_OVERLAY}
      centered
      destroyOnClose
      className="nx-tpl-modal"
      title={
        starter ? (
          <span className="nx-ad-modal-title">
            <span>
              {starter.name} <em>template</em>
            </span>
            <small>{starter.when}</small>
          </span>
        ) : null
      }
    >
      {starter && (
        <div className="nx-doc-col" data-testid={`starter-detail-${starter.id}`}>
          <Segmented
            aria-label="Preview or code"
            value={view}
            onChange={(value) => setView(value as "preview" | "code")}
            options={[
              { value: "preview", label: "Preview" },
              { value: "code", label: "Code" },
            ]}
          />
          {view === "preview" ? (
            <Stage mode="app" className="nx-tpl-stage">
              {Page ? <Page /> : null}
            </Stage>
          ) : (
            <CodeBlock code={TEMPLATE_SOURCE[starter.id] ?? ""} file={`${starter.id}.tsx`} maxHeight={560} />
          )}
        </div>
      )}
    </Modal>
  );
}

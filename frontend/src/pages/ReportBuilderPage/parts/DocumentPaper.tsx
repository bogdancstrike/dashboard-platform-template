import { Typography } from "antd";

import { BlockPreview } from "@/components/documents/DocumentBlocks";
import { EmptyState } from "@/components/EmptyState";

const { Paragraph, Title } = Typography;

import type { ReadyBuilder } from "../useReportBuilder";

/** The document itself, drawn from the endpoints that answer each block. */
export function DocumentPaper({ view }: { view: ReadyBuilder }) {
  const { selected, setSelected, registerChart, resources, stored, blocks, page } = view;
  return (
    <>
      {/* The document. Not an impression of it — the same three endpoints
          the server resolves each block through when it writes the file. */}
      <div className="nu-doc-paper-wrap">
        <article
          className={`nu-doc-paper is-${page.orientation}`}
          data-testid="document-paper"
          style={{ ["--nu-doc-accent" as string]: page.accent }}
        >
          {page.header && <div className="nu-doc-runhead">{page.header}</div>}
          <div className="nu-doc-body" style={{ padding: `${page.margin_mm}px` }}>
            {page.cover && (
              <header className="nu-doc-cover">
                <Title level={1} className="nu-doc-cover-title">
                  {stored?.name}
                </Title>
                {page.subtitle && (
                  <Paragraph className="nu-doc-cover-sub">{page.subtitle}</Paragraph>
                )}
                <div className="nu-doc-break" aria-label="Page break">
                  <span>page break</span>
                </div>
              </header>
            )}
            {blocks.map((block) => (
              <section
                key={block.id}
                className={`nu-doc-block${selected === block.id ? " is-chosen" : ""}`}
                onClick={() => setSelected(block.id)}
                data-testid={`block-${block.id}`}
              >
                <BlockPreview
                  block={block}
                  resources={resources.data?.items ?? []}
                  onChart={registerChart}
                />
              </section>
            ))}
            {blocks.length === 0 && (
              <EmptyState compact title="An empty document. Add a block from the left." />
            )}
          </div>
          {(page.footer || page.page_numbers) && (
            <div className="nu-doc-runfoot">
              <span>{page.footer}</span>
              {page.page_numbers && <span>1</span>}
            </div>
          )}
        </article>
      </div>
    </>
  );
}

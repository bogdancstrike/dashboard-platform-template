

import { type PageLayout } from "@/pages/showcase/templates";

/**
 * A layout's shape, drawn from its declaration.
 *
 * Twelve columns, because that is the grid the product is built on — so a
 * region reading "span 4" here is a region that would be `span={4}` there.
 * `role="img"` with one label rather than a dozen announced boxes: a screen
 * reader gets the sentence the picture is making, which is the shape, and not
 * a recitation of its parts.
 */
export function Wireframe({ layout }: { layout: PageLayout }) {
  return (
    <div
      className="nu-wire"
      role="img"
      data-testid={`wireframe-${layout.key}`}
      aria-label={`${layout.name}: ${layout.wireframe
        .map((row) => row.map((region) => region.label).join(", then "))
        .join("; below that, ")}`}
    >
      {layout.wireframe.map((row, index) => (
        <div className="nu-wire-row" key={index}>
          {row.map((region, at) => (
            <span
              // Two "Card"s of the same width in one row are legitimate.
              key={`${at}:${region.label}`}
              className={`nu-wire-box${region.primary ? " is-primary" : ""}`}
              style={{
                gridColumn: `span ${region.span}`,
                ...(region.rows ? { gridRow: `span ${region.rows}` } : {}),
              }}
            >
              {region.label}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

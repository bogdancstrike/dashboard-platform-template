import { kindLabel } from "./favorites";

/** A record type as a soft pill with a dot — the design's "Type" cell. */
export function KindPill({ kind }: { kind: string }) {
  return (
    <span className={`nx-fd-kindpill nx-fd-kindpill--${kind}`}>
      <span className="nx-fd-kinddot" aria-hidden="true" />
      {kindLabel(kind)}
    </span>
  );
}

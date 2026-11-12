import { CopyButton } from "../CodeBlock";

const SWATCHES = [
  ["--nu-text", "Ink — body text"],
  ["--nu-text-secondary", "Muted ink"],
  ["--nu-text-tertiary", "Faint ink — captions"],
  ["--nu-accent", "Accent — the one colour that means \"act\""],
  ["--nu-accent-ink", "Accent as text"],
  ["--nu-tint", "Accent tint — chips, icon tiles"],
  ["--nu-ok-fill", "Healthy"],
  ["--nu-warn-fill", "Needs a look"],
  ["--nu-bad-fill", "Broken"],
  ["--nu-glass", "Glass — every panel"],
  ["--nu-raised", "Raised — a lifted row"],
  ["--nu-field", "Field — an input's well"],
];

export default function TokensColours() {
  return (
    <div className="nx-doc-swatches">
      {SWATCHES.map(([name, what]) => (
        <div key={name} className="nx-doc-swatch">
          <span className="nx-doc-chip" style={{ background: `var(${name})` }} />
          <span className="nx-doc-swatchtext">
            <code>{name}</code>
            <span>{what}</span>
          </span>
          <CopyButton text={`var(${name})`} label="Copy" />
        </div>
      ))}
    </div>
  );
}

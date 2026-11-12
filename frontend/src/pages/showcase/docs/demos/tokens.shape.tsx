import { RADIUS } from "@/theme/tokens";

const RADII = [
  { name: "control", value: RADIUS.control },
  { name: "card", value: RADIUS.card },
  { name: "modal", value: RADIUS.modal },
  { name: "pill", value: 22 },
];

const SHADOWS = ["--nu-lift", "--nu-glass-shadow", "--nu-shadow-md", "--nu-shadow-lg"];

export default function TokensShape() {
  return (
    <div className="nx-doc-col">
      <div className="nx-doc-row">
        {RADII.map((radius) => (
          <div key={radius.name} className="nx-doc-shape" style={{ borderRadius: radius.value }}>
            <b>{radius.name}</b>
            <code>{radius.name === "pill" ? "999px" : `${radius.value}px`}</code>
          </div>
        ))}
      </div>
      <div className="nx-doc-row">
        {SHADOWS.map((shadow) => (
          <div key={shadow} className="nx-doc-shape nx-doc-shape--shadow" style={{ boxShadow: `var(${shadow})` }}>
            <code>{shadow}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

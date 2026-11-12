const SCALE = [
  { name: "Page title", className: "nx-doc-t-title", sample: "Organisation dashboard", spec: "Inter 700 · 34 / 1.08 · -0.03em" },
  { name: "Modal title", className: "nx-doc-t-modal", sample: "New role", spec: "Inter 700 · 24 · -0.025em" },
  { name: "KPI number", className: "nx-doc-t-kpi", sample: "1,061", spec: "Inter 700 · 30 · tabular" },
  { name: "Card title", className: "nx-doc-t-card", sample: "Effective permissions", spec: "Inter 700 · 15" },
  { name: "Body", className: "nx-doc-t-body", sample: "The nightly ERP sync failed twice.", spec: "Inter 400 · 14 / 1.5" },
  { name: "Caption", className: "nx-doc-t-caption", sample: "Updated 4 minutes ago by Ana Marin", spec: "Inter 500 · 12" },
  { name: "Overline", className: "nx-doc-t-over", sample: "ADMINISTRATION", spec: "Inter 700 · 11 · 0.1em caps" },
  { name: "Mono", className: "nx-doc-t-mono", sample: "ORD-20931 · nx_live_…8c2f", spec: "Mono · 12.5" },
];

export default function TokensType() {
  return (
    <div className="nx-doc-type">
      {SCALE.map((row) => (
        <div key={row.name}>
          <small>{row.name}</small>
          <span className={row.className}>
            {row.className === "nx-doc-t-title" ? (
              <>
                Organisation <em className="nx-em">dashboard</em>
              </>
            ) : (
              row.sample
            )}
          </span>
          <code>{row.spec}</code>
        </div>
      ))}
    </div>
  );
}

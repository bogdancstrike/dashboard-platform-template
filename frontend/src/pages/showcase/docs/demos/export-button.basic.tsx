import { ExportButton } from "@/components/ExportButton";

export default function ExportButtonBasic() {
  return (
    <div className="nx-doc-row">
      <ExportButton onExport={() => Promise.resolve()} />
      <ExportButton onExport={() => Promise.resolve()} onQueue={() => Promise.resolve()} label="Export all 48,210" />
      <ExportButton onExport={() => Promise.resolve()} disabled label="Nothing to export" />
    </div>
  );
}

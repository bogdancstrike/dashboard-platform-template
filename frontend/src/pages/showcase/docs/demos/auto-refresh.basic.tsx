import { AutoRefresh } from "@/components/AutoRefresh";

export default function AutoRefreshBasic() {
  return (
    <div className="nx-doc-row">
      <AutoRefresh page="showcase" refresh={() => undefined} updatedAt={Date.now() - 240_000} />
      <span className="nx-doc-muted">Off by default, parked while the tab is hidden.</span>
    </div>
  );
}

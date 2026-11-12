export default function KpiTileAdmin() {
  return (
    <div className="nx-ad nx-doc-flat">
      <div className="nx-ad-tiles">
        <div className="nx-ad-tile">
          <small>Checks run</small>
          <b>14</b>
          <span>Every dataset, every rule</span>
        </div>
        <div className="nx-ad-tile">
          <small>With something in them</small>
          <b>8</b>
          <span>1,061 records involved</span>
        </div>
        <div className="nx-ad-tile">
          <small>Contradictions</small>
          <b>3</b>
          <span>A state that cannot be true</span>
        </div>
      </div>
    </div>
  );
}

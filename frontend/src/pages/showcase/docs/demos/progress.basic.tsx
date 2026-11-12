import { Progress } from "antd";

export default function ProgressBasic() {
  return (
    <div className="nx-doc-grid">
      <div className="nx-doc-col">
        <Progress percent={64} aria-label="Building the export" />
        <Progress percent={100} aria-label="Done" />
        <Progress percent={42} status="exception" aria-label="Failed at row 42" />
        <Progress percent={30} status="active" showInfo={false} aria-label="Working" />
      </div>
      <div className="nx-doc-row">
        <Progress type="circle" percent={75} size={80} aria-label="Uptime" />
        <Progress type="dashboard" percent={98} size={80} aria-label="Healthy checks" />
        <Progress steps={5} percent={60} aria-label="Three of five steps" />
      </div>
    </div>
  );
}

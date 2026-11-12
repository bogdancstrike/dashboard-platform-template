import { Card, Skeleton, Spin } from "antd";

export default function SkeletonBasic() {
  return (
    <div className="nx-doc-grid">
      <Card>
        <Skeleton active avatar paragraph={{ rows: 3 }} />
      </Card>
      <Card>
        <Skeleton.Input active block />
        <br />
        <br />
        <Skeleton.Button active /> <Skeleton.Button active shape="round" />
      </Card>
      <Card>
        <Spin tip="Loading the window…">
          <div style={{ height: 96 }} />
        </Spin>
      </Card>
    </div>
  );
}

import { Pagination } from "antd";

export default function PaginationBasic() {
  return (
    <div className="nx-doc-col">
      <Pagination defaultCurrent={1} total={1284} pageSize={25} showSizeChanger={false} />
      <Pagination simple defaultCurrent={3} total={90} />
    </div>
  );
}

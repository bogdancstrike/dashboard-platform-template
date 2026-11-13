import { Button, Typography } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined } from "@ant-design/icons";

import { BlockEditor } from "../BlockEditor";
import { BlockView } from "../BlockView";
import { DOC_BLOCKS } from "../blocks";

import { AddBlock } from "./AddBlock";
import type { DocViewModel } from "./useDocView";

const { Text } = Typography;

/** The blocks — drawn, or each with its editor and its rail while editing. */
export function DocBody({ m }: { m: DocViewModel }) {
  const { editing, people, setBlocks, createTask, runTask, move, insertAt, tick } = m;
  const draft = m.draft!;
  const data = m.data!;
  return (
    <div className={`nx-dc-body${editing ? " is-editing" : ""}`} data-testid="doc-body">
      {draft.blocks.length === 0 && !editing && (
        <Text type="secondary">This page is empty.{data.can_edit ? " Press Edit to write something." : ""}</Text>
      )}
      {draft.blocks.map((block, index) =>
        editing ? (
          <div key={block.id} className="nx-dc-edit-block" data-testid={`edit-${block.kind}`}>
            <div className="nx-dc-edit-rail">
              <span className="nx-dc-kind">{DOC_BLOCKS[block.kind].icon}</span>
              <Button type="text" icon={<ArrowUpOutlined />} aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)} />
              <Button type="text" icon={<ArrowDownOutlined />} aria-label="Move down" disabled={index === draft.blocks.length - 1} onClick={() => move(index, 1)} />
              <Button type="text" danger icon={<DeleteOutlined />} aria-label="Remove block" onClick={() => setBlocks(draft.blocks.filter((item) => item.id !== block.id))} />
            </div>
            <div className="nx-dc-edit-main">
              <BlockEditor
                block={block}
                onChange={(next) => setBlocks(draft.blocks.map((item) => (item.id === block.id ? next : item)))}
              />
              {block.kind === "action" && block.text && !block.task_id && data.can_create_tasks && (
                <Button className="nu-block" onClick={() => runTask(block.id)} loading={createTask.isPending && createTask.variables === block.id}>
                  Create task
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div key={block.id} className="nx-dc-block">
            <BlockView
              block={block}
              tasks={data.tasks}
              people={people}
              canCreateTasks={data.can_edit && data.can_create_tasks}
              creatingTask={createTask.isPending ? (createTask.variables ?? null) : null}
              onCreateTask={data.can_edit ? runTask : undefined}
              onToggleAction={
                data.can_edit
                  ? (id, done) => tick(draft.blocks.map((item) => (item.id === id ? { ...item, done } : item)))
                  : undefined
              }
              onToggleCheck={
                data.can_edit
                  ? (id, at, done) =>
                      tick(
                        draft.blocks.map((item) =>
                          item.id === id
                            ? {
                                ...item,
                                items: (item.items ?? []).map((raw, i) =>
                                  i === at ? { text: typeof raw === "string" ? raw : raw.text, done } : raw,
                                ),
                              }
                            : item,
                        ),
                      )
                  : undefined
              }
            />
          </div>
        ),
      )}
      {editing && <AddBlock onAdd={(kind) => insertAt(draft.blocks.length, kind)} />}
    </div>
  );
}

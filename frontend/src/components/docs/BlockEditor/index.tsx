/** A block's editor in the wiki page editor (§48): a registry from block kind to editor. */

import {
  ActionEditor,
  ChartBlockEditor,
  ImageBlockEditor,
  RecordBlockEditor,
  ReportBlockEditor,
} from "./dataEditors";
import {
  CalloutEditor,
  ChecklistEditor,
  CodeEditor,
  HeadingEditor,
  ListEditor,
  ProseEditor,
} from "./textEditors";
import type { BlockEditorRegistry, EditorProps } from "./registry";
import { TableEditor } from "./TableEditor";

const EDITORS: BlockEditorRegistry = {
  heading: HeadingEditor,
  text: ProseEditor,
  quote: ProseEditor,
  callout: CalloutEditor,
  code: CodeEditor,
  list: ListEditor,
  checklist: ChecklistEditor,
  table: TableEditor,
  image: ImageBlockEditor,
  chart: ChartBlockEditor,
  report: ReportBlockEditor,
  record: RecordBlockEditor,
  action: ActionEditor,
};

/** The editor for one block, chosen by its kind; a kind with no editor draws nothing. */
export function BlockEditor({ block, onChange }: EditorProps) {
  const Editor = EDITORS[block.kind];
  return Editor ? <Editor block={block} onChange={onChange} /> : null;
}

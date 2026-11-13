/**
 * Which editor a block kind gets — one entry per kind, so adding a kind is
 * adding a line here and a component, not a case in a growing switch.
 */

import type { ComponentType } from "react";

import type { DocBlock, DocBlockKind } from "@/api/docs";

export interface EditorProps {
  block: DocBlock;
  onChange: (next: DocBlock) => void;
}

export type BlockEditorRegistry = Partial<Record<DocBlockKind, ComponentType<EditorProps>>>;

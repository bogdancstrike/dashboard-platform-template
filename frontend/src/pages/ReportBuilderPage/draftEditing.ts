/** Editing the draft in memory: the page, and adding, changing, moving and removing blocks. */

import { type BlockKind, type DocumentBlock, type DocumentPage } from "@/api/reportDocuments";
import { newBlock } from "@/components/documents/blocks";
import type { Capturable } from "@/components/documents/DocumentBlocks";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

type Draft = { page: DocumentPage; blocks: DocumentBlock[] };

/** The draft's edits; nothing reaches the server until Save. */
export function draftEditing({
  blocks,
  setDraft,
  setSelected,
  charts,
}: {
  blocks: DocumentBlock[];
  setDraft: Dispatch<SetStateAction<Draft | null>>;
  setSelected: Dispatch<SetStateAction<string | null>>;
  charts: MutableRefObject<Map<string, Capturable>>;
}) {
  const change = (next: Partial<{ page: DocumentPage; blocks: DocumentBlock[] }>) =>
    setDraft((current) => (current ? { ...current, ...next } : current));

  const editBlock = (id: string, patch: Partial<DocumentBlock>) =>
    change({
      blocks: blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)),
    });

  const addBlock = (kind: BlockKind) => {
    const block = newBlock(kind, blocks);
    change({ blocks: [...blocks, block] });
    setSelected(block.id);
  };

  const moveBlock = (id: string, by: number) => {
    const index = blocks.findIndex((block) => block.id === id);
    const target = index + by;
    if (index < 0 || target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    change({ blocks: next });
  };

  const dropBlock = (id: string) => {
    charts.current.delete(id);
    change({ blocks: blocks.filter((block) => block.id !== id) });
    setSelected((current) => (current === id ? null : current));
  };

  return { change, editBlock, addBlock, moveBlock, dropBlock };
}

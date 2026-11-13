import { App } from "antd";
import type { ClipboardEvent, KeyboardEvent } from "react";

import { clamp, parseClipboard } from "@/lib/gridSheet";

import type { GridModel } from "./useGridModel";

/**
 * The keyboard and the clipboard: arrows move, Shift selects, Tab and Enter
 * move on, F2 or typing edits, Escape cancels, Delete clears, Ctrl+C/V copy
 * and paste, Ctrl+D fills down, Ctrl+Z/Y undo and redo, Ctrl+S saves.
 */
export function useGridInput(model: GridModel, save: () => Promise<void>) {
  const { message } = App.useApp();
  const {
    columns, canEdit, rows, editing, focus, range, moveTo, step, fillDown, setAnchor, setFocus, startEdit,
    clearSelection, selectionTSV, write,
  } = model;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[key]) {
      event.preventDefault();
      const [dr, dc] = arrows[key];
      const jump = mod ? (dr ? rows.length : columns.length) : 1;
      moveTo({ row: focus.row + dr * jump, col: focus.col + dc * jump }, event.shiftKey);
      return;
    }
    if (key === "Tab") {
      event.preventDefault();
      moveTo({ row: focus.row, col: focus.col + (event.shiftKey ? -1 : 1) });
      return;
    }
    if (mod && key.toLowerCase() === "z") {
      event.preventDefault();
      step(event.shiftKey ? "forward" : "back");
      return;
    }
    if (mod && key.toLowerCase() === "y") {
      event.preventDefault();
      step("forward");
      return;
    }
    if (mod && key.toLowerCase() === "d") {
      event.preventDefault();
      if (canEdit) fillDown();
      return;
    }
    if (mod && key.toLowerCase() === "s") {
      event.preventDefault();
      void save();
      return;
    }
    if (mod && key.toLowerCase() === "a") {
      event.preventDefault();
      setAnchor({ row: 0, col: 0 });
      setFocus({ row: rows.length - 1, col: columns.length - 1 });
      return;
    }
    if (mod) return; // let copy and paste reach their events
    if (key === "Enter" || key === "F2") {
      event.preventDefault();
      startEdit(focus);
      return;
    }
    if (key === "Escape") {
      setAnchor(focus);
      return;
    }
    if ((key === "Delete" || key === "Backspace") && canEdit) {
      event.preventDefault();
      clearSelection();
      return;
    }
    if (key.length === 1 && !event.altKey) {
      event.preventDefault();
      startEdit(focus, key);
    }
  };

  const onCopy = (event: ClipboardEvent<HTMLDivElement>) => {
    if (editing) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", selectionTSV());
    const cells = (range.bottom - range.top + 1) * (range.right - range.left + 1);
    void message.info(`Copied ${cells} cell${cells === 1 ? "" : "s"}.`);
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (editing || !canEdit) return;
    event.preventDefault();
    const block = parseClipboard(event.clipboardData.getData("text/plain"));
    if (!block.length) return;
    const origin = { row: range.top, col: range.left };
    const cells: { row: number; col: number; raw: string }[] = [];
    let skipped = 0;
    block.forEach((line, r) =>
      line.forEach((raw, c) => {
        const row = origin.row + r;
        const col = origin.col + c;
        if (row >= rows.length || col >= columns.length) skipped += 1;
        else if (!columns[col]!.editable) skipped += 1;
        else cells.push({ row, col, raw });
      }),
    );
    const changed = write(cells);
    setAnchor(origin);
    setFocus(clamp({ row: origin.row + block.length - 1, col: origin.col + Math.max(...block.map((l) => l.length)) - 1 }, rows.length, columns.length));
    void message.info(`Pasted ${block.length}×${Math.max(...block.map((l) => l.length))} — ${changed} cell${changed === 1 ? "" : "s"} changed${skipped ? `, ${skipped} outside the editable grid skipped` : ""}.`);
  };

  return { onKeyDown, onCopy, onPaste };
}

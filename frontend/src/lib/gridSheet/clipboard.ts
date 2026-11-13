/** Reading a pasted block, and writing one back out. */

/**
 * A clipboard block as rows of cells. Excel and Sheets put TSV on the
 * clipboard; a CSV file opened in an editor gives commas — so a block with
 * tabs is TSV, one without tabs but with commas is CSV. Quoted cells may hold
 * the separator, doubled quotes and line breaks.
 */
export function parseClipboard(text: string): string[][] {
  const source = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (!source) return [];
  const separator = source.includes("\t") ? "\t" : source.includes(",") ? "," : "\t";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === separator) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/** A block as TSV, quoting what would otherwise break a cell. */
export function toTSV(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => (/[\t\n"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join("\t"))
    .join("\n");
}

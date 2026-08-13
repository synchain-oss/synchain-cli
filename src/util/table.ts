/**
 * Minimal ASCII table renderer. Auto-fits column widths to the widest cell
 * (clamped to MAX_CELL_WIDTH). Longer cells are truncated with an ellipsis.
 */

import { sanitizeInline } from "./sanitize.js";

const MAX_CELL_WIDTH = 60;
const ELLIPSIS = "…";

export interface TableColumn {
  header: string;
  /** Cell key in the row object. */
  key: string;
  /** Optional max-width override. */
  maxWidth?: number;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return s.slice(0, max);
  return s.slice(0, max - 1) + ELLIPSIS;
}

// 所有表格单元（讨论 ls / 日历 ls / 文件 / 文件夹 / 项目 / 通知）的单一汇聚点：在此消毒
// 服务端来源字符串，去掉 ANSI/控制字符并把换行折叠成空格（防转义注入 + 防换行破坏对齐）（(内部编号)）。
// toCell 在宽度计算与渲染两处都先于 truncate 调用，故消毒后再量宽，对齐一致。
function toCell(v: unknown): string {
  if (v == null) return "";
  return sanitizeInline(v);
}

/**
 * Renders rows as an aligned ASCII table:
 *   header1  header2
 *   -------  -------
 *   row1     row2
 */
export function renderTable(columns: TableColumn[], rows: Array<Record<string, unknown>>): string {
  const widths = columns.map((col) => {
    const max = col.maxWidth ?? MAX_CELL_WIDTH;
    let widest = col.header.length;
    for (const row of rows) {
      const cell = truncate(toCell(row[col.key]), max);
      if (cell.length > widest) widest = cell.length;
    }
    return Math.min(widest, max);
  });

  const lines: string[] = [];
  lines.push(columns.map((col, i) => col.header.padEnd(widths[i]!, " ")).join("  "));
  lines.push(columns.map((_, i) => "-".repeat(widths[i]!)).join("  "));
  for (const row of rows) {
    lines.push(
      columns
        .map((col, i) => {
          const max = col.maxWidth ?? MAX_CELL_WIDTH;
          const cell = truncate(toCell(row[col.key]), max);
          return cell.padEnd(widths[i]!, " ");
        })
        .join("  ")
    );
  }
  return lines.join("\n");
}

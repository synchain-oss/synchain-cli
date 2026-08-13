/**
 * 终端输出消毒（(内部编号)）。服务端来源的用户内容（讨论标题/正文/作者名、日历标题/自定义标签/
 * 创建者名等）打到终端前必须去掉 ANSI 转义序列与控制字符——否则恶意同项目成员可在这些字段里
 * 嵌入 ESC 序列，当受害者运行 `synchain discussion ls/read` 或 `calendar ls` 时移动光标、改色、
 * 清行/回车覆盖(CR spoofing)、设窗口标题，甚至触发某些终端的转义驱动行为（终端转义注入）。
 *
 * picocolors 生成的颜色是 CLI 自己加的、安全；危险的只是【原始服务端字符串】。因此在两个输出汇
 * 聚点（util/table.ts 的 toCell、commands/discussion.ts 的 renderThread）统一消毒即可覆盖全部。
 * 【不消毒 JSON 输出】：`--json` 走 JSON.stringify，控制字符已被转成 \uXXXX，是机器可解析的、非注入向量。
 */

// 匹配 CSI（ESC[ … 终止符）、OSC（ESC] … BEL/ST）、以及单字符 C1 风格转义（ESC + 0x40-0x5F）。
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B(?:\[[0-9;?:]*[ -/]*[@-~]|\][\s\S]*?(?:\x07|\x1B\\)|[@-Z\\-_])/g;

function asString(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/**
 * 多行体消毒（讨论正文）：去 ANSI，再去除除 TAB(\x09)/LF(\x0A) 外的所有 C0/C1 控制字符与 DEL。
 * 保留 \n\t 维持排版；去掉 \r 挫败回车覆盖；剥掉任何残留 ESC（作为 ANSI_RE 的安全网）。
 */
export function sanitizeBlock(v: unknown): string {
  // eslint-disable-next-line no-control-regex
  return asString(v)
    .replace(ANSI_RE, "")
    .replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, "");
}

/**
 * 单行体消毒（表格单元 / 单行头）：去 ANSI，再把所有控制字符（含 \r\n\t）折叠成空格——
 * 注入的换行也无法破坏表格对齐或伪造行结构。
 */
export function sanitizeInline(v: unknown): string {
  // eslint-disable-next-line no-control-regex
  return asString(v)
    .replace(ANSI_RE, "")
    .replace(/[\x00-\x1F\x7F-\x9F]/g, " ");
}

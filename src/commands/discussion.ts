// SPDX-License-Identifier: MIT
import pc from "picocolors";
import { apiFetch, ApiError, formatApiError, resolveActiveProject, wantsJson } from "../api.js";
import { loadConfig } from "../config.js";
import { renderTable } from "../util/table.js";
import { isUuid, resolveByPrefix } from "../util/resolve-id.js";
import { sanitizeInline, sanitizeBlock, shortId } from "../util/sanitize.js";

// Discussion categories (see lib/discussion/types.ts).
const CATEGORIES = ["mix", "master", "art", "release", "vocal", "general"] as const;
type Category = (typeof CATEGORIES)[number];

/** Flat post as served by GET /discussion (camelCase, with the author's name). */
export interface DiscussionPost {
  id: string;
  projectId: string;
  userId: string;
  parentId: string | null;
  title: string;
  content: string;
  category: string | null;
  pinned: boolean;
  threadState: string;
  isEdited: boolean;
  isAiGenerated: boolean;
  createdAt: string;
  updatedAt: string;
  authorName: string;
}

interface DiscussionListResponse {
  posts: DiscussionPost[];
}

/** A root thread in a paginated `discussion ls` page (server stamps replyCount). */
export interface PagedDiscussionPost extends DiscussionPost {
  replyCount: number;
}

/** Paginated GET /discussion response (returned when ?limit / ?offset is sent). */
interface DiscussionPageResponse {
  posts: PagedDiscussionPost[];
  total: number;
  limit: number;
  offset: number;
}

/** The POST /discussion response is the raw inserted row (snake_case). */
interface CreatedRow {
  id: string;
}

export interface DiscussionFlags {
  title?: string;
  content?: string;
  category?: string;
  project?: string;
  json?: boolean;
  limit?: string;
  offset?: string;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ""; // nothing piped — don't hang.
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchPosts(projectId: string): Promise<DiscussionPost[]> {
  const res = await apiFetch<DiscussionListResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/discussion`
  );
  return res.posts;
}

/**
 * Builds the `?limit&offset` query for `discussion ls`. Always includes `limit`
 * (default 50) so the server uses its paginated mode; `offset` defaults to 0.
 * commander passes flag values as strings — the server does the numeric parsing
 * and clamps (limit ∈ [1,100], offset ≥ 0), so we forward them verbatim.
 * Exported for tests.
 */
export function buildListQuery(flags: DiscussionFlags): string {
  const qs = new URLSearchParams();
  qs.set("limit", flags.limit ?? "50");
  qs.set("offset", flags.offset ?? "0");
  return qs.toString();
}

/** Fetch one page of root threads (with server-side reply counts) for `discussion ls`. */
async function fetchPage(
  projectId: string,
  flags: DiscussionFlags
): Promise<DiscussionPageResponse> {
  return apiFetch<DiscussionPageResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/discussion?${buildListQuery(flags)}`
  );
}

/** Builds a thread tree from a flat post list and renders it. Exported for tests. */
export function renderThread(root: DiscussionPost, all: DiscussionPost[]): string {
  const byParent = new Map<string, DiscussionPost[]>();
  for (const p of all) {
    if (!p.parentId) continue;
    const arr = byParent.get(p.parentId) ?? [];
    arr.push(p);
    byParent.set(p.parentId, arr);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const aiTag = (p: DiscussionPost) => (p.isAiGenerated ? " [AI]" : "");
  const lines: string[] = [];
  // 消毒服务端字段：单行头用 sanitizeInline（防注入换行伪造连接线/缩进），正文用
  // sanitizeBlock（保留多行结构、去 ANSI/CR/控制字符）。aiTag/connector/indent 是 CLI 生成、安全。
  lines.push(
    `${sanitizeInline(root.title)}${aiTag(root)} — by ${sanitizeInline(root.authorName)} @ ${sanitizeInline(root.createdAt)}`
  );
  lines.push("-----");
  lines.push(sanitizeBlock(root.content));
  lines.push("-----");

  // 任意深度嵌套（撤销两级限制后线程可深于 2 层）；visited 防脏数据里的 parent_id 环
  // 导致无限递归（Web 两处 buildReplyTree/fetchProjectDiscussion 已各有防环）。
  const visited = new Set<string>();
  function walk(parent: DiscussionPost, depth: number): void {
    if (visited.has(parent.id)) return;
    visited.add(parent.id);
    const children = byParent.get(parent.id) ?? [];
    const indent = "    ".repeat(depth);
    children.forEach((child, idx) => {
      const isLast = idx === children.length - 1;
      const connector = isLast ? "└──" : "├──";
      lines.push(
        `${indent}${connector} ${shortId(child.id)} by ${sanitizeInline(child.authorName)}${aiTag(child)} @ ${sanitizeInline(child.createdAt)}`
      );
      const contentIndent = `${indent}    `;
      for (const contentLine of sanitizeBlock(child.content).split("\n"))
        lines.push(`${contentIndent}${contentLine}`);
      walk(child, depth + 1);
    });
  }
  walk(root, 0);
  return lines.join("\n");
}

/**
 * Table rows for a paginated `discussion ls` page. Uses the server-supplied
 * `replyCount` directly — no client-side tree walk (a page holds only root
 * threads, not their replies). Exported for tests.
 */
export function threadTableRows(posts: PagedDiscussionPost[]): Array<Record<string, unknown>> {
  return posts.map((t) => ({
    id: shortId(t.id),
    title: t.title,
    author: t.authorName,
    category: t.category ?? "",
    state: t.threadState,
    ai: t.isAiGenerated ? "[AI]" : "",
    replies: t.replyCount,
    updated: t.updatedAt,
  }));
}

/**
 * Footer for a paginated `discussion ls` page — a "showing X–Y of N" line, plus
 * a `--offset` hint when a next page exists. Returns null when a single page
 * covers everything (offset 0 and the page holds every thread). Exported for tests.
 */
export function paginationFooter(
  offset: number,
  count: number,
  total: number,
  limit: number
): string | null {
  const hasNext = offset + count < total;
  if (offset === 0 && !hasNext) return null;
  let line = `Showing ${offset + 1}–${offset + count} of ${total} threads`;
  if (hasNext) line += ` · next page: --offset ${offset + limit}`;
  return line;
}

export async function runDiscussionLs(flags: DiscussionFlags): Promise<void> {
  const cfg = await loadConfig();
  try {
    const projectId = resolveActiveProject(cfg, flags.project);
    const res = await fetchPage(projectId, flags);
    if (wantsJson(flags)) {
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    if (res.posts.length === 0) {
      // Distinguish "paged past the end" from a genuinely empty project so an
      // `--offset` overrun doesn't read as "(no discussion threads)".
      if (res.offset > 0 && res.total > 0) {
        console.log(
          pc.dim(
            `(no threads at offset ${res.offset} — ${res.total} total; use a smaller --offset)`
          )
        );
      } else {
        console.log(pc.dim("(no discussion threads)"));
      }
      return;
    }
    console.log(
      renderTable(
        [
          { header: "id", key: "id" },
          { header: "title", key: "title" },
          { header: "author", key: "author" },
          { header: "category", key: "category" },
          { header: "state", key: "state" },
          { header: "ai", key: "ai" },
          { header: "replies", key: "replies" },
          { header: "updated", key: "updated" },
        ],
        threadTableRows(res.posts)
      )
    );
    // 页脚：仅当有上一页（offset>0）或有下一页时显示（单页覆盖全部则省略）。
    const footer = paginationFooter(res.offset, res.posts.length, res.total, res.limit);
    if (footer) console.log(pc.dim(footer));
  } catch (err) {
    console.error(pc.red(formatApiError(err)));
    process.exitCode = 1;
    return;
  }
}

export async function runDiscussionRead(postId: string, flags: DiscussionFlags): Promise<void> {
  const cfg = await loadConfig();
  try {
    const projectId = resolveActiveProject(cfg, flags.project);
    const posts = await fetchPosts(projectId);
    // Resolve exactly like `discussion reply` (exact id → unique prefix → error on
    // zero/ambiguous). A previous `find(startsWith)` silently picked the first hit,
    // so a shared prefix could `read` a different thread than `reply` targets.
    const root = await resolveByPrefix(postId, async () => posts, "post");
    // If the user passed a reply id, walk up to its root for thread context.
    let effectiveRoot = root;
    const byId = new Map(posts.map((p) => [p.id, p] as const));
    const seen = new Set<string>();
    while (effectiveRoot.parentId && !seen.has(effectiveRoot.id)) {
      seen.add(effectiveRoot.id);
      const parent = byId.get(effectiveRoot.parentId);
      if (!parent) break;
      effectiveRoot = parent;
    }

    if (wantsJson(flags)) {
      const wanted = new Set<string>([effectiveRoot.id]);
      let frontier = [effectiveRoot.id];
      while (frontier.length > 0) {
        const next: string[] = [];
        for (const p of posts) {
          if (p.parentId && frontier.includes(p.parentId) && !wanted.has(p.id)) {
            wanted.add(p.id);
            next.push(p.id);
          }
        }
        frontier = next;
      }
      console.log(
        JSON.stringify(
          posts.filter((p) => wanted.has(p.id)),
          null,
          2
        )
      );
      return;
    }

    console.log(renderThread(effectiveRoot, posts));
  } catch (err) {
    console.error(pc.red(formatApiError(err)));
    process.exitCode = 1;
    return;
  }
}

async function resolveContent(flagContent: string | undefined): Promise<string> {
  if (flagContent === undefined) {
    throw new Error("--content is required (use '-' to read from stdin).");
  }
  if (flagContent === "-") {
    const piped = (await readStdin()).trim();
    if (!piped) throw new Error("--content '-' was given but stdin was empty.");
    return piped;
  }
  return flagContent;
}

function validateCategory(c: string | undefined): Category {
  if (!c) return "general";
  if ((CATEGORIES as readonly string[]).includes(c)) return c as Category;
  throw new Error(`Invalid --category "${c}". Must be one of: ${CATEGORIES.join(", ")}.`);
}

const AI_NOTE =
  "Note: writes via a CLI key are flagged is_ai_generated=true and display an [AI] badge in the web UI.";

export async function runDiscussionPost(flags: DiscussionFlags): Promise<void> {
  const cfg = await loadConfig();
  try {
    if (!flags.title || !flags.title.trim()) {
      console.error(pc.red("--title is required and must be non-empty."));
      process.exitCode = 1;
      return;
    }
    const projectId = resolveActiveProject(cfg, flags.project);
    const category = validateCategory(flags.category);
    const content = (await resolveContent(flags.content)).trim();
    if (!content) {
      console.error(pc.red("--content must be non-empty."));
      process.exitCode = 1;
      return;
    }

    const created = await apiFetch<CreatedRow>(
      `/api/projects/${encodeURIComponent(projectId)}/discussion`,
      { method: "POST", body: { title: flags.title!.trim(), content, category } }
    );

    if (wantsJson(flags)) {
      console.log(JSON.stringify(created, null, 2));
    } else {
      console.log(pc.green(`Created thread ${sanitizeInline(created.id)}`));
      console.log(pc.dim(AI_NOTE));
    }
  } catch (err) {
    console.error(pc.red(formatApiError(err)));
    process.exitCode = 1;
    return;
  }
}

export async function runDiscussionReply(
  parentPostId: string,
  flags: DiscussionFlags
): Promise<void> {
  const cfg = await loadConfig();
  try {
    const projectId = resolveActiveProject(cfg, flags.project);
    const content = (await resolveContent(flags.content)).trim();
    if (!content) {
      console.error(pc.red("--content must be non-empty."));
      process.exitCode = 1;
      return;
    }

    // a full UUID posts directly — only an 8-char prefix needs the
    // full-thread fetch (discussion has no single-post GET to resolve against).
    // The server's zod schema rejects non-UUIDs and the POST validates that the
    // parent exists (its 404 is handled below), so no client-side pre-check is lost.
    const parentId = isUuid(parentPostId)
      ? parentPostId
      : (await resolveByPrefix(parentPostId, () => fetchPosts(projectId), "post")).id;

    const created = await apiFetch<CreatedRow>(
      `/api/projects/${encodeURIComponent(projectId)}/discussion`,
      { method: "POST", body: { parentId, content } }
    );

    if (wantsJson(flags)) {
      console.log(JSON.stringify(created, null, 2));
    } else {
      console.log(pc.green(`Replied to ${shortId(parentId)} (new post id: ${sanitizeInline(created.id)}).`));
      console.log(pc.dim(AI_NOTE));
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      console.error(pc.red(`Parent post ${parentPostId} not found.`));
      process.exitCode = 1;
      return;
    }
    if (err instanceof Error && /No post matches|prefix.*ambiguous/.test(err.message)) {
      console.error(pc.red(err.message));
      process.exitCode = 1;
      return;
    }
    console.error(pc.red(formatApiError(err)));
    process.exitCode = 1;
    return;
  }
}

export const DISCUSSION_HELP = {
  name: "discussion",
  summary: "Read project discussion threads and post / reply from the terminal.",
  body: [
    "Usage:",
    "  synchain discussion ls [--limit <n>] [--offset <n>] [--project <p>] [--json]",
    "  synchain discussion read <postId> [--project <p>] [--json]",
    "  synchain discussion post --title <t> --content <c|-> [--category <c>] [--project <p>] [--json]",
    "  synchain discussion reply <postId> --content <c|-> [--project <p>] [--json]",
    "",
    "Categories: mix, master, art, release, vocal, general (default general).",
    "`--content -` reads the post body from stdin (handy for piping in a file).",
    "",
    "`ls` is paginated: it lists root threads (default 50 per page, max 100) with a",
    "reply count each. Use --offset to page through (the footer prints the next",
    "--offset). `read <postId>` still shows the full thread tree.",
    "",
    "Every write made through a CLI key is stamped `is_ai_generated=true` on the",
    "server and rendered with an `[AI]` badge in the web UI (and in `ls` / `read`).",
  ].join("\n"),
};

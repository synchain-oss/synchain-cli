// SPDX-License-Identifier: MIT
import pc from "picocolors";
import { apiFetch, formatApiError, wantsJson } from "../api.js";
import { loadConfig } from "../config.js";
import { isUuid, resolveByPrefix } from "../util/resolve-id.js";
import { sanitizeInline, shortId, safeNumber } from "../util/sanitize.js";

/** A notification view-model as served by GET /api/user/notifications. */
export interface NotificationItem {
  id: string;
  projectId: string;
  projectName: string;
  type: string;
  referenceType: string;
  referenceId: string;
  entityTitle: string | null;
  actorName: string | null;
  isRead: boolean;
  createdAt: string;
}

interface NotificationsResponse {
  items: NotificationItem[];
  unreadCount: number;
}

export interface NotificationsFlags {
  all?: boolean;
  limit?: string;
  json?: boolean;
}

/**
 * Compact "2h ago"-style relative time. Exported for tests.
 *
 * The unparseable branch returns the server's raw string, so it sanitizes **inside the
 * function** rather than leaning on the caller -- same contract as `formatLocal` in
 * `calendar.ts`. A function that is exported and whose safety depends on what its one current
 * caller happens to do is a trap for the second caller: they would have to re-derive this
 * reasoning, or silently not.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return sanitizeInline(iso);
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

/** One compact readable line per notification, including its id. Exported for tests. */
export function formatNotificationLine(n: NotificationItem, now?: number): string {
  // projectName/entityTitle/actorName 是服务端来源的用户内容（项目名 / 讨论标题·文件名 /
  // 作者名）。这条命令自建输出行，不经 util/table.ts 或 discussion.ts 的消毒汇聚点，故在此显式过
  // sanitizeInline，去掉 ANSI 转义与控制字符，挫败同项目成员经这些字段发起的终端转义注入。
  const parts = [n.projectName, n.entityTitle, n.actorName]
    .filter((p): p is string => Boolean(p))
    .map((p) => sanitizeInline(p));
  const marker = n.isRead ? " " : "•";
  // `relativeTime` returns the raw ISO string when Date.parse fails, so an unparseable
  // server timestamp reaches the terminal verbatim -- sanitize the rendered value, not the input.
  const when = sanitizeInline(relativeTime(n.createdAt, now)).padEnd(7);
  return `${marker} ${sanitizeInline(n.id)}  ${when}  [${sanitizeInline(n.type)}] ${parts.join(" · ")}`;
}

export async function runNotificationsLs(flags: NotificationsFlags): Promise<void> {
  await loadConfig();
  try {
    const qs = new URLSearchParams();
    if (flags.all) qs.set("all", "1");
    if (flags.limit) qs.set("limit", flags.limit);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await apiFetch<NotificationsResponse>(`/api/user/notifications${suffix}`);

    if (wantsJson(flags)) {
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    if (res.items.length === 0) {
      console.log(pc.dim(flags.all ? "(no notifications)" : "(no unread notifications)"));
    } else {
      for (const n of res.items) console.log(formatNotificationLine(n));
    }
    console.log(pc.dim(`${safeNumber(res.unreadCount)} unread`));
  } catch (err) {
    console.error(pc.red(formatApiError(err)));
    process.exitCode = 1;
    return;
  }
}

/** Resolve a notification id (full UUID or 8-char prefix) to a full UUID. */
async function resolveNotificationId(input: string): Promise<string> {
  if (isUuid(input)) return input;
  const res = await apiFetch<NotificationsResponse>("/api/user/notifications?all=1&limit=100");
  const match = await resolveByPrefix(input, async () => res.items, "notification");
  return match.id;
}

export async function runNotificationsRead(
  id: string | undefined,
  flags: NotificationsFlags
): Promise<void> {
  await loadConfig();
  try {
    if (flags.all) {
      const res = await apiFetch<{ ok: boolean; updated: number }>(
        "/api/user/notifications/read-all",
        { method: "POST" }
      );
      if (wantsJson(flags)) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(
          pc.green(
            `Marked ${safeNumber(res.updated)} notification${res.updated === 1 ? "" : "s"} read.`
          )
        );
      }
      return;
    }

    if (!id) {
      console.error(pc.red("Provide a notification id, or use --all to mark everything read."));
      process.exitCode = 1;
      return;
    }

    const resolvedId = await resolveNotificationId(id);
    const res = await apiFetch<{ ok: boolean; updated: number }>(
      `/api/user/notifications/${encodeURIComponent(resolvedId)}/read`,
      { method: "POST" }
    );
    if (wantsJson(flags)) {
      console.log(JSON.stringify(res, null, 2));
    } else if (res.updated > 0) {
      console.log(pc.green(`Marked ${shortId(resolvedId)} read.`));
    } else {
      console.log(pc.dim(`${shortId(resolvedId)} was already read (or not found).`));
    }
  } catch (err) {
    if (err instanceof Error && /No notification matches|prefix.*ambiguous/.test(err.message)) {
      console.error(pc.red(err.message));
      process.exitCode = 1;
      return;
    }
    console.error(pc.red(formatApiError(err)));
    process.exitCode = 1;
    return;
  }
}

// SPDX-License-Identifier: MIT
import pc from "picocolors";
import { apiFetch, formatApiError, resolveActiveProject, wantsJson } from "../api.js";
import { loadConfig } from "../config.js";
import { renderTable } from "../util/table.js";
import { shortId } from "../util/sanitize.js";

/** One project member as served by GET /api/projects/[id]/members (camelCase). */
export interface Member {
  userId: string;
  name: string;
  permission: string;
  creativeRole: string | null;
  roleTag: string | null;
  joinedAt: string;
}

interface MembersListResponse {
  members: Member[];
}

export interface MembersFlags {
  project?: string;
  json?: boolean;
}

/** Render the members roster as an aligned table. Exported for tests. */
export function renderMembersTable(members: Member[]): string {
  const rows = members.map((m) => ({
    id: shortId(m.userId),
    name: m.name,
    permission: m.permission,
    // Prefer the project-specific creative role; fall back to the profile role tag.
    role: m.creativeRole || m.roleTag || "",
    joined: m.joinedAt,
  }));
  return renderTable(
    [
      { header: "id", key: "id" },
      { header: "name", key: "name" },
      { header: "permission", key: "permission" },
      { header: "role", key: "role" },
      { header: "joined", key: "joined" },
    ],
    rows
  );
}

export async function runMembersLs(flags: MembersFlags): Promise<void> {
  const cfg = await loadConfig();
  try {
    const projectId = resolveActiveProject(cfg, flags.project);
    const res = await apiFetch<MembersListResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/members`
    );
    const members = res.members;
    if (wantsJson(flags)) {
      console.log(JSON.stringify({ members }, null, 2));
      return;
    }
    if (members.length === 0) {
      console.log(pc.dim("(no members)"));
      return;
    }
    console.log(renderMembersTable(members));
  } catch (err) {
    console.error(pc.red(formatApiError(err)));
    process.exitCode = 1;
    return;
  }
}

export const MEMBERS_HELP = {
  name: "members",
  summary: "List project members from the terminal (read-only).",
  body: [
    "Usage:",
    "  synchain members ls [--project <p>] [--json]",
    "",
    "Lists everyone in the active project with their permission (admin / member /",
    "viewer), creative role, and join date, sorted admin → member → viewer.",
    "",
    "The `members` scope is OFF by default and gated by BOTH an account-level toggle",
    "(Settings → CLI Access) and a project-level toggle (Project Settings → CLI). A",
    "project admin must enable `members` for your key AND for the project, otherwise",
    "the API returns 403 (`scope_denied` / `project_scope_denied`).",
  ].join("\n"),
};

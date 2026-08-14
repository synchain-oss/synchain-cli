// SPDX-License-Identifier: MIT
import pc from "picocolors";
import { apiFetch, formatApiError, wantsJson } from "../api.js";
import { loadConfig, saveConfig } from "../config.js";
import { resolveByPrefix } from "../util/resolve-id.js";
import { renderTable } from "../util/table.js";
import type { MeResponse } from "./login.js";

export interface ProjectLsFlags {
  json?: boolean;
}

export async function runProjectLs(flags: ProjectLsFlags): Promise<void> {
  try {
    const me = await apiFetch<MeResponse>("/api/user/me");
    const projects = me.projects;
    if (wantsJson(flags)) {
      console.log(JSON.stringify({ projects }, null, 2));
      return;
    }
    if (projects.length === 0) {
      console.log(pc.dim("(no project memberships)"));
      return;
    }
    const cfg = await loadConfig();
    const activeId = cfg?.activeProject?.id;
    const rows = projects.map((p) => ({
      active: p.id === activeId ? "*" : "",
      id: p.id.slice(0, 8),
      name: p.name,
      role: p.role,
    }));
    console.log(
      renderTable(
        [
          { header: " ", key: "active", maxWidth: 1 },
          { header: "id", key: "id" },
          { header: "name", key: "name" },
          { header: "role", key: "role" },
        ],
        rows
      )
    );
  } catch (err) {
    console.error(pc.red(formatApiError(err)));
    process.exitCode = 1;
    return;
  }
}

export async function runProjectUse(input: string): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg?.token) {
    console.error(pc.red("Not logged in. Run `synchain login`."));
    process.exitCode = 1;
    return;
  }

  try {
    const me = await apiFetch<MeResponse>("/api/user/me");
    const projects = me.projects;
    // Full UUID or unique 8-char prefix (the same shape `ls` prints).
    const resolved = await resolveByPrefix(input, async () => projects, "project");
    await saveConfig({
      ...cfg,
      activeProject: { id: resolved.id, name: resolved.name },
    });
    console.log(pc.green(`Active project set to ${resolved.name} (${resolved.id.slice(0, 8)}).`));
  } catch (err) {
    console.error(pc.red(formatApiError(err)));
    process.exitCode = 1;
    return;
  }
}

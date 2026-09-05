// SPDX-License-Identifier: MIT
import pc from "picocolors";
import { apiFetch, formatApiError, wantsJson } from "../api.js";
import { loadConfig, saveConfig } from "../config.js";
import { isUuid, projectRefLabel, resolveProjectRef } from "../util/resolve-id.js";
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
      ref: projectRefLabel(p),
      name: p.name,
      role: p.role,
    }));
    console.log(
      renderTable(
        [
          { header: " ", key: "active", maxWidth: 1 },
          { header: "ref", key: "ref" },
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
    // Custom ID (exact) -> UUID (exact) -> UUID (unique prefix). Each namespace keeps its
    // own candidate pool; the reason is at the top of util/resolve-id.ts -- one shared pool
    // lets a short hex custom ID resolve silently to a different project.
    const resolved = await resolveProjectRef(input, async () => projects);
    // What gets persisted **must** be the canonical UUID, never the custom ID the user
    // typed. `activeProject.id` from config.json is interpolated verbatim into every
    // `/api/projects/<id>/...` path, and that whole API surface accepts UUIDs only --
    // every one of those routes has its own UUID guard and answers 400 otherwise. More
    // importantly, a custom ID is **mutable**: storing one means some later `files rm`
    // fires at a string that no longer points at this project. This assertion is that
    // invariant's last gate on the CLI side -- if anyone ever writes `input` here it fails
    // on the spot, instead of leaving every later command to hit one of those two outcomes.
    if (!isUuid(resolved.id)) {
      throw new Error(`Resolved project id is not a canonical UUID: ${resolved.id}`);
    }
    await saveConfig({
      ...cfg,
      activeProject: { id: resolved.id, name: resolved.name },
    });
    console.log(pc.green(`Active project set to ${resolved.name} (${projectRefLabel(resolved)}).`));
  } catch (err) {
    console.error(pc.red(formatApiError(err)));
    process.exitCode = 1;
    return;
  }
}

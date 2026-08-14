// SPDX-License-Identifier: MIT
import pc from "picocolors";
import { apiFetch, formatApiError, wantsJson } from "../api.js";
import { loadConfig } from "../config.js";
import { userLabel, type MeResponse } from "./login.js";

export interface WhoamiFlags {
  json?: boolean;
}

export async function runWhoami(flags: WhoamiFlags): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg?.token) {
    console.error(pc.red("Not logged in. Run `synchain login`."));
    process.exitCode = 1;
    return;
  }

  try {
    const me = await apiFetch<MeResponse>("/api/user/me");
    if (wantsJson(flags)) {
      console.log(
        JSON.stringify(
          { user: me.user, projects: me.projects, activeProject: cfg?.activeProject ?? null },
          null,
          2
        )
      );
      return;
    }
    const suffix = me.user.email ? ` (${me.user.email})` : "";
    console.log(`Logged in as ${pc.bold(userLabel(me.user))}${suffix}`);
    const active = cfg?.activeProject;
    if (active?.id) {
      console.log(
        `Active project: ${pc.bold(active.name ?? active.id)} (${active.id.slice(0, 8)})`
      );
    }
    console.log(`Run \`${pc.cyan("synchain project ls")}\` to see your projects.`);
  } catch (err) {
    console.error(pc.red(formatApiError(err)));
    process.exitCode = 1;
    return;
  }
}

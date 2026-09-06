// SPDX-License-Identifier: MIT
import pc from "picocolors";
import { apiFetch, formatApiError, wantsJson } from "../api.js";
import { loadConfig } from "../config.js";
import { sanitizeInline, shortId } from "../util/sanitize.js";
import { userLabel, type MeResponse } from "./login.js";

export interface WhoamiFlags {
  json?: boolean;
}

/**
 * The "Active project" line, as a pure function.
 *
 * `name` here comes out of **config.json**, not off the wire -- `project use` wrote it, and it
 * originated as a server string any admin of that project controls. That makes this the one
 * place where such a payload is *persisted* and replayed: without sanitizing here, every later
 * `synchain whoami` re-emits the escape sequence, offline, with no request involved.
 * Sanitizing at this output boundary (rather than before `saveConfig`) also disarms configs
 * that an earlier version already wrote.
 *
 * `--json` is deliberately left alone: JSON.stringify escapes control characters, which is
 * machine-parsable and not an injection vector.
 */
export function activeProjectLine(active: { id: string; name?: string | null }): string {
  const label = pc.bold(sanitizeInline(active.name ?? active.id));
  // The id is sanitized too, and **before** slicing so the cut can never land mid-escape and
  // emit a bare ESC. It looks like it could not need this -- `project use` now asserts the id
  // is a canonical UUID before saving -- but that assertion is new in this release: 0.6.0
  // wrote through whatever the server sent, so a poisoned id may already be sitting in a
  // config on disk, and 8 characters is room enough for an erase-line sequence.
  const short = shortId(active.id);
  return `Active project: ${label} (${short})`;
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
    // Sanitized for consistency with the output-boundary rule stated above, even though these
    // are the signed-in user's *own* profile fields (self-inflicted at worst, not
    // cross-tenant): an exception one line from the rule only confuses the next reader.
    const suffix = me.user.email ? ` (${sanitizeInline(me.user.email)})` : "";
    console.log(`Logged in as ${pc.bold(sanitizeInline(userLabel(me.user)))}${suffix}`);
    const active = cfg?.activeProject;
    if (active?.id) {
      console.log(activeProjectLine(active));
    }
    console.log(`Run \`${pc.cyan("synchain project ls")}\` to see your projects.`);
  } catch (err) {
    console.error(pc.red(formatApiError(err)));
    process.exitCode = 1;
    return;
  }
}

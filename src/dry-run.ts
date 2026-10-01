// SPDX-License-Identifier: MIT
import pc from "picocolors";

import { wantsJson } from "./api.js";
import { sanitizeInline } from "./util/sanitize.js";

/**
 * Why `--dry-run` exists in this CLI, beyond "a CLI that writes should have one":
 *
 * The CLI is built to be driven by AI agents, and every id it takes also resolves from an
 * **8-character prefix**. A prefix is a convenience for a person typing; for an agent it is a
 * trap. Copy a prefix from the wrong line, or mix up two records' prefixes, and `files rm`
 * silently deletes someone else's file -- found out only afterwards. `--dry-run` is the safety
 * valve on that path: see which id the prefix resolved to, and what that record is called,
 * before sending anything.
 *
 * The description shared by all thirteen write commands, so they read the same to an agent
 * enumerating `--help --format json`. It names the two things callers get wrong: ids are
 * resolved (that is the point), and the exit code is 0.
 */
export const DRY_RUN_DESC =
  "Preview only: resolve ids, validate input, print what would change, send no write (exit 0)";

/**
 * The machine-readable form of a dry run (`--json` / `--format json`).
 *
 * - `dryRun` is always true and always first. Callers often send the preview and the real run
 *   through the same log or the same parser; a field that is always there answers "was this a
 *   preview?" with one `in` check, instead of inferring it from which other fields are missing.
 * - `action` is `<group>.<command>` (`files.rm`), not a command line (`synchain files rm`): it is
 *   a stable identifier to switch on, and leaving the binary name and aliases (`notif`) out of
 *   it keeps callers intact when those change.
 * - `target` is free-form per command. A shared table of every possible field would force
 *   null fields that mean nothing for most commands (rm has no newName, mkdir has no file); the
 *   `action` already says which shape to expect.
 */
export interface DryRunPlan {
  dryRun: true;
  action: string;
  target: Record<string, unknown>;
}

/**
 * Prints a dry run's plan and returns normally: the caller then `return`s, and the process
 * exits 0. A rehearsal that went through is a success. A non-zero code would stop a `set -e`
 * script, and any agent that treats non-zero as failure, right at the preview -- and "preview,
 * then run" could not be used at all.
 *
 * The plan goes to stdout, not stderr: it is this invocation's result, not progress or a
 * warning, and a `--json` caller reads stdout.
 *
 * `summary` is the text form: `would <verb> <target>…`. It interpolates names, ids and counts
 * that came off the wire, and is sanitized **here**, once, for every caller -- a per-call-site
 * sanitize is exactly what the next caller would forget. Call sites still pass ids through
 * `shortId` and counts through `safeNumber`, for readability; safety does not depend on it.
 * `target` keeps raw values: `JSON.stringify` escapes control characters (ESC becomes
 * `\u001b`), the same rule as every other `--json` output.
 */
export function reportDryRun(
  flags: { json?: boolean } | undefined,
  plan: { action: string; target: Record<string, unknown>; summary: string }
): void {
  if (wantsJson(flags)) {
    const out: DryRunPlan = { dryRun: true, action: plan.action, target: plan.target };
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.log(`${pc.yellow("[dry-run]")} ${sanitizeInline(plan.summary)}`);
  console.log(pc.dim("No changes were made. Re-run without --dry-run to apply."));
}

// SPDX-License-Identifier: MIT
import type { Command } from "commander";

/**
 * Legal values of the global `--format <fmt>` option.
 *
 * One constant, fed to commander's `.choices()`, so a typo is rejected at parse time. Without
 * the check `--format yaml` would quietly fall back to text, and an agent would only see its
 * own JSON.parse fail, with nothing pointing at the misspelt format name.
 */
export const OUTPUT_FORMATS = ["text", "json"] as const;

export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/**
 * Does argv ask for machine-readable output? For the few decisions that must be made before
 * commander has parsed anything -- today only the first-run welcome banner, which would already
 * be on screen by the time `program.opts()` could be read.
 *
 * All three spellings count: `--json` (each command's own flag, kept for backward
 * compatibility), `--format json` and `--format=json`. Everything after parsing should use
 * {@link resolveOutputFormat} instead: argv cannot tell an option from an option *value* that
 * happens to read `--json`.
 */
export function argvWantsJsonOutput(argv: readonly string[]): boolean {
  return argv.some((arg, index) => {
    if (arg === "--json" || arg === "--format=json") return true;
    return arg === "--format" && argv[index + 1] === "json";
  });
}

/**
 * The output format in effect for a parsed command.
 *
 * `--format` is declared on the root program only, and commander does not hand a parent's
 * options down to its subcommands: `files ls` sees only its own opts. So walk up the parent
 * chain. Without that, `synchain --format json files ls` would silently print text -- an option
 * that is accepted but has no effect.
 */
export function resolveOutputFormat(command: Command): OutputFormat {
  for (let cursor: Command | null = command; cursor !== null; cursor = cursor.parent) {
    const { format } = cursor.opts() as { format?: unknown };
    if (format === "json") return "json";
  }
  return "text";
}

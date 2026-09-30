// SPDX-License-Identifier: MIT
import type { Command } from "commander";

/**
 * The shape printed by `synchain --help --format json`: the command tree as data.
 *
 * An agent meeting an unfamiliar CLI starts by asking what commands exist. Text help is laid out
 * for people, so the agent is left guessing names and flags out of the layout, and a wrong guess
 * becomes a call to a command that does not exist. With the tree as JSON it can enumerate
 * `commands` / `options` directly.
 *
 * - `usage` is commander's own usage string (`[options] <localPath>`): positional arguments and
 *   whether they are required are all in it, without a second arguments array to keep in step
 *   with commander's rendering.
 * - `aliases` appears only when non-empty. One command in the CLI has an alias
 *   (`notifications` / `notif`); an empty array on every other node would only suggest aliases
 *   are common.
 * - `-h, --help` is left out: commander keeps it outside `options`, and every command has it.
 */
export interface CommandTreeOption {
  flags: string;
  description: string;
}

export interface CommandTreeNode {
  name: string;
  description: string;
  usage: string;
  options: CommandTreeOption[];
  commands: CommandTreeNode[];
  aliases?: string[];
}

/** The document root: a node plus the installed CLI version. */
export interface CommandTree extends CommandTreeNode {
  version: string;
}

/**
 * One command and everything below it, as plain data.
 *
 * A pure function over commander's public getters, so it can be tested without running the CLI:
 * the risk here is a commander upgrade changing what `options` / `commands` hold, and only a
 * direct assertion on the result would show that.
 */
export function serializeCommand(command: Command): CommandTreeNode {
  const node: CommandTreeNode = {
    name: command.name(),
    description: command.description(),
    usage: command.usage(),
    options: command.options.map((option) => ({
      flags: option.flags,
      description: option.description,
    })),
    commands: command.commands.map((child) => serializeCommand(child)),
  };
  const aliases = command.aliases();
  if (aliases.length > 0) node.aliases = aliases;
  return node;
}

/**
 * The whole command tree, whichever command's `--help` was asked for.
 *
 * `synchain files --help --format json` prints the same document as `synchain --help --format
 * json`: one call is enough to learn the entire surface, and the answer does not depend on where
 * `--help` happened to land.
 *
 * `version` sits on the root only -- subcommands ship in the same package, so repeating it is
 * noise. `?? ""` keeps the field present: commander's `version()` getter is undefined until
 * `.version(str)` is called, and JSON.stringify would drop an undefined field outright.
 */
export function buildHelpJson(command: Command): CommandTree {
  let root = command;
  while (root.parent) root = root.parent;
  const { name, ...rest } = serializeCommand(root);
  return { name, version: root.version() ?? "", ...rest };
}

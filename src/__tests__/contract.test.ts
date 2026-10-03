// SPDX-License-Identifier: MIT
import { Command, CommanderError } from "commander";
import { describe, expect, it, vi } from "vitest";

import { DRY_RUN_DESC } from "../dry-run.js";
import type { CommandTree, CommandTreeNode, CommandTreeOption } from "../help-json.js";

// Stub the handlers: these cases read the command tree and parse argv; no command may run.
vi.mock("../commands/files.js", () => ({
  runFilesLs: vi.fn(),
  runFilesUpload: vi.fn(),
  runFilesDownload: vi.fn(),
  runFilesMv: vi.fn(),
  runFilesRename: vi.fn(),
  runFilesRm: vi.fn(),
}));
vi.mock("../commands/folders.js", () => ({
  runFoldersLs: vi.fn(),
  runFoldersMkdir: vi.fn(),
  runFoldersRename: vi.fn(),
  runFoldersRm: vi.fn(),
}));
vi.mock("../commands/calendar.js", () => ({
  runCalendarAdd: vi.fn(),
  runCalendarEdit: vi.fn(),
  runCalendarLs: vi.fn(),
  runCalendarRm: vi.fn(),
}));
vi.mock("../commands/discussion.js", () => ({
  runDiscussionLs: vi.fn(),
  runDiscussionPost: vi.fn(),
  runDiscussionRead: vi.fn(),
  runDiscussionReply: vi.fn(),
}));
vi.mock("../commands/notifications.js", () => ({
  runNotificationsLs: vi.fn(),
  runNotificationsRead: vi.fn(),
}));
vi.mock("../commands/help.js", () => ({ runHelp: vi.fn() }));

type Mock = ReturnType<typeof vi.fn>;

function lastCall(fn: unknown): unknown[] {
  const calls = (fn as Mock).mock.calls;
  return calls[calls.length - 1]!;
}

/**
 * The machine-readable contract, read the way an agent reads it: from `--help --format json`.
 *
 * Every command is sorted into exactly one of three lists below, and the lists are written out
 * rather than derived from the tree. A derived list cannot turn red when someone adds a write
 * command without `--dry-run` -- exactly the case worth catching. With explicit lists, a new
 * command fails "every command is classified" until its author decides which list it belongs
 * to, and the per-list checks then hold it to that list's promise.
 */

/** Commands that change remote data: each takes `--dry-run`, and `--json` for the plan. */
const WRITE_COMMANDS = [
  "files upload",
  "files mv",
  "files rename",
  "files rm",
  "folders mkdir",
  "folders rename",
  "folders rm",
  "calendar add",
  "calendar edit",
  "calendar rm",
  "discussion post",
  "discussion reply",
  "notifications read",
];

/** Commands that only read: each has a JSON form, so `--format json` reaches all of them. */
const READ_COMMANDS = [
  "whoami",
  "project ls",
  "files ls",
  "folders ls",
  "calendar ls",
  "discussion ls",
  "discussion read",
  "members ls",
  "notifications ls",
  "doctor",
];

/**
 * Neither: local state only (`login`, `logout`, `project use`), raw file bytes rather than a
 * result (`files download`), or help. `--dry-run` promises "no remote data changes"; on these it
 * would read as "nothing happens at all", and that would water down its promise on `rm`.
 */
const OTHER_COMMANDS = ["login", "logout", "project use", "files download", "help"];

/** Parse `synchain <args>` with every command's exit and output captured (see help-json.test.ts). */
async function run(args: string[]): Promise<{ out: string; err: string; error: unknown }> {
  const { buildProgram } = await import("../program.js");
  const program = buildProgram();
  let out = "";
  let err = "";
  const visit = (cmd: Command): void => {
    cmd.exitOverride();
    cmd.configureOutput({
      writeOut: (str) => {
        out += str;
      },
      writeErr: (str) => {
        err += str;
      },
    });
    cmd.commands.forEach(visit);
  };
  visit(program);
  let error: unknown;
  try {
    await program.parseAsync(["node", "synchain", ...args]);
  } catch (e) {
    error = e;
  }
  return { out, err, error };
}

async function commandTree(): Promise<CommandTree> {
  const { out } = await run(["--help", "--format", "json"]);
  return JSON.parse(out) as CommandTree;
}

/** Every runnable command (a node without subcommands), keyed by its path below the root. */
function leaves(tree: CommandTree): Map<string, CommandTreeOption[]> {
  const found = new Map<string, CommandTreeOption[]>();
  const visit = (node: CommandTreeNode, prefix: string): void => {
    const name = prefix ? `${prefix} ${node.name}` : node.name;
    if (node.commands.length === 0) found.set(name, node.options);
    for (const child of node.commands) visit(child, name);
  };
  for (const child of tree.commands) visit(child, "");
  return found;
}

function flagsOf(options: CommandTreeOption[] | undefined): string[] {
  return (options ?? []).map((option) => option.flags);
}

describe("command tree (`--help --format json`)", () => {
  it("classifies every command exactly once", async () => {
    const actual = [...leaves(await commandTree()).keys()].sort();
    const listed = [...WRITE_COMMANDS, ...READ_COMMANDS, ...OTHER_COMMANDS].sort();
    expect(new Set(listed).size).toBe(listed.length);
    expect(actual).toEqual(listed);
  });

  it.each(WRITE_COMMANDS)("write command `%s` declares --dry-run and --json", async (name) => {
    const options = leaves(await commandTree()).get(name);
    expect(flagsOf(options)).toEqual(expect.arrayContaining(["--dry-run", "--json"]));
    // One shared description: all thirteen read the same to an agent enumerating the tree.
    expect(options!.find((option) => option.flags === "--dry-run")!.description).toBe(
      DRY_RUN_DESC
    );
  });

  it.each(READ_COMMANDS)("read command `%s` declares --json and no --dry-run", async (name) => {
    const flags = flagsOf(leaves(await commandTree()).get(name));
    expect(flags).toContain("--json");
    expect(flags).not.toContain("--dry-run");
  });

  it.each(OTHER_COMMANDS)("`%s` does not declare --dry-run", async (name) => {
    const tree = leaves(await commandTree());
    expect(tree.has(name)).toBe(true);
    expect(flagsOf(tree.get(name))).not.toContain("--dry-run");
  });

  it("the shared description says what a caller would otherwise guess wrong", () => {
    // Ids are resolved (that is why the flag exists) and the exit code is 0 (a non-zero
    // rehearsal would break `set -e` scripts and agents that treat non-zero as failure).
    expect(DRY_RUN_DESC).toMatch(/resolve/i);
    expect(DRY_RUN_DESC).toContain("exit 0");
  });
});

/**
 * A link in `--help` that 404s for a reader without repository access is worse than no link: the
 * reader -- a person, an agent, a scanner grading the package -- concludes the docs are gone or
 * the tool is abandoned. This has happened once already: both documentation links pointed into a
 * private repository. So hosts are allow-listed; adding a link means registering its host here
 * and answering "does it open for an anonymous visitor?". Same list as help-topics.test.ts, which
 * holds `synchain help` to it; this case holds commander's `--help` screen.
 */
const ALLOWED_HOSTS = new Set(["www.synchain.ca", "www.npmjs.com"]);

describe("text `--help`", () => {
  it("links only to publicly reachable hosts", async () => {
    const { out, error } = await run(["--help"]);
    expect((error as CommanderError).exitCode).toBe(0);
    const urls = out.match(/https?:\/\/[^\s)]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      const u = new URL(url);
      const ok =
        ALLOWED_HOSTS.has(u.host) ||
        (u.host === "github.com" && u.pathname.startsWith("/synchain-oss/synchain-cli/"));
      expect(ok, `${url}: host not on the allow-list`).toBe(true);
    }
  });
});

describe("parsing --dry-run", () => {
  it("`files rm <id> --json --dry-run` reaches the handler with both flags", async () => {
    const filesMod = await import("../commands/files.js");
    const { error } = await run(["files", "rm", "abcd1234", "--json", "--dry-run"]);
    expect(error).toBeUndefined();
    const [fileId, opts] = lastCall(filesMod.runFilesRm);
    expect(fileId).toBe("abcd1234");
    expect(opts).toMatchObject({ json: true, dryRun: true });
  });

  it("without --dry-run the handler sees no dryRun at all", async () => {
    const foldersMod = await import("../commands/folders.js");
    await run(["folders", "mkdir", "vocals"]);
    expect(lastCall(foldersMod.runFoldersMkdir)[1]).not.toHaveProperty("dryRun");
  });

  it.each([
    ["files", "rm", () => import("../commands/files.js"), "runFilesRm"],
    ["folders", "rm", () => import("../commands/folders.js"), "runFoldersRm"],
    ["calendar", "rm", () => import("../commands/calendar.js"), "runCalendarRm"],
  ] as const)(
    "`--format json %s %s --dry-run` now turns on --json (the rm commands have one)",
    async (group, sub, load, handler) => {
      const mod = (await load()) as unknown as Record<string, Mock>;
      const { error } = await run(["--format", "json", group, sub, "abcd1234", "--dry-run"]);
      expect(error).toBeUndefined();
      expect(lastCall(mod[handler])[1]).toMatchObject({ json: true, dryRun: true });
    }
  );

  it("is not global: a command without it rejects it instead of running for real", async () => {
    const filesMod = await import("../commands/files.js");
    const before = (filesMod.runFilesDownload as Mock).mock.calls.length;
    const { error } = await run(["files", "download", "abcd1234", "--dry-run"]);
    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe("commander.unknownOption");
    expect((filesMod.runFilesDownload as Mock).mock.calls.length).toBe(before);
  });
});

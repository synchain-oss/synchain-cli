// SPDX-License-Identifier: MIT
import { Command, CommanderError } from "commander";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

import { DOCS_AGENTS, DOCS_README } from "../constants.js";
import { buildHelpJson, serializeCommand, type CommandTreeNode } from "../help-json.js";

// Stub the discussion handlers (keeping the module's other exports, which `help.ts` reads):
// help must be printed without any handler running.
vi.mock("../commands/discussion.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../commands/discussion.js")>()),
  runDiscussionLs: vi.fn(),
  runDiscussionPost: vi.fn(),
  runDiscussionRead: vi.fn(),
  runDiscussionReply: vi.fn(),
}));

type Mock = ReturnType<typeof vi.fn>;

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

/**
 * A small hand-built tree rather than buildProgram(): the real program has dozens of commands,
 * so assertions against it can only say "contains X". Here the structure itself is under test
 * (three levels deep, options in registration order, aliases only where they exist).
 */
function buildFixture(): Command {
  const program = new Command();
  program.name("demo").description("demo root").version("1.2.3");
  const files = program.command("files").description("manage files");
  files
    .command("ls")
    .description("list files")
    .option("--json", "Output JSON")
    .option("--folder <id>", "Folder id");
  program.command("notifications").alias("notif").description("your notifications");
  return program;
}

/** Parse `synchain <args>` with every command's exit and output captured (see output-format.test.ts). */
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

/** Every node, depth first. */
function walk(node: CommandTreeNode): CommandTreeNode[] {
  return [node, ...node.commands.flatMap(walk)];
}

describe("buildHelpJson (fixture tree)", () => {
  it("recurses three levels deep (root → group → leaf)", () => {
    const tree = buildHelpJson(buildFixture());

    expect(tree.name).toBe("demo");
    expect(tree.version).toBe("1.2.3");
    expect(tree.description).toBe("demo root");

    const files = tree.commands.find((cmd) => cmd.name === "files");
    expect(files?.description).toBe("manage files");
    const ls = files?.commands.find((cmd) => cmd.name === "ls");
    expect(ls?.options).toEqual([
      { flags: "--json", description: "Output JSON" },
      { flags: "--folder <id>", description: "Folder id" },
    ]);
    expect(ls?.commands).toEqual([]);
  });

  it("describes the whole tree whichever command's help was asked for", () => {
    const program = buildFixture();
    const ls = program.commands.find((cmd) => cmd.name() === "files")!.commands[0]!;
    expect(buildHelpJson(ls)).toEqual(buildHelpJson(program));
  });

  it("round-trips through JSON.stringify without losing fields", () => {
    // JSON.stringify drops undefined values and throws on cycles; either would make the printed
    // document differ from this object.
    const tree = buildHelpJson(buildFixture());
    expect(JSON.parse(JSON.stringify(tree)) as unknown).toEqual(tree);
  });

  it("emits aliases only for the commands that have one", () => {
    const tree = buildHelpJson(buildFixture());
    expect(tree.commands.find((cmd) => cmd.name === "notifications")?.aliases).toEqual(["notif"]);
    expect(tree.commands.find((cmd) => cmd.name === "files")).not.toHaveProperty("aliases");
  });

  it("falls back to an empty version string when none was set", () => {
    expect(buildHelpJson(new Command().name("bare")).version).toBe("");
  });

  it("keeps commander's computed usage string (positional arguments included)", () => {
    const upload = new Command()
      .name("demo")
      .command("upload <localPath>")
      .description("upload a file")
      .option("--folder <id>", "Folder id");
    expect(serializeCommand(upload)).toMatchObject({
      name: "upload",
      description: "upload a file",
      usage: "[options] <localPath>",
    });
  });
});

describe("`--help --format json` on the real program", () => {
  it("prints one parseable command tree on stdout and nothing else", async () => {
    const { out, err, error } = await run(["--help", "--format", "json"]);
    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).exitCode).toBe(0);
    expect(err).toBe("");

    // The whole of stdout must parse: an afterHelp block appended to the document would break it.
    const tree = JSON.parse(out) as ReturnType<typeof buildHelpJson>;
    expect(tree.name).toBe("synchain");
    expect(tree.version).toBe(pkg.version);
    expect(tree.options.map((option) => option.flags)).toContain("--format <fmt>");

    const topLevel = tree.commands.map((cmd) => cmd.name);
    for (const name of [
      "login",
      "logout",
      "whoami",
      "project",
      "files",
      "folders",
      "calendar",
      "discussion",
      "members",
      "notifications",
      "help",
    ]) {
      expect(topLevel).toContain(name);
    }

    for (const node of walk(tree)) {
      expect(typeof node.name).toBe("string");
      expect(typeof node.description).toBe("string");
      expect(typeof node.usage).toBe("string");
      expect(Array.isArray(node.commands)).toBe(true);
      for (const option of node.options) {
        expect(Object.keys(option).sort()).toEqual(["description", "flags"]);
      }
    }

    const filesLs = tree.commands
      .find((cmd) => cmd.name === "files")
      ?.commands.find((cmd) => cmd.name === "ls");
    expect(filesLs?.description).toContain("List files");
    expect(filesLs?.options.map((option) => option.flags)).toContain("--json");
  });

  it("`-h --format=json` (short flag, inline value) also yields JSON", async () => {
    const { out } = await run(["-h", "--format=json"]);
    expect((JSON.parse(out) as { name: string }).name).toBe("synchain");
  });

  it("`files --help --format json` prints the same parseable tree", async () => {
    const root = await run(["--help", "--format", "json"]);
    const { out, error } = await run(["files", "--help", "--format", "json"]);
    expect((error as CommanderError).exitCode).toBe(0);
    expect(JSON.parse(out) as unknown).toEqual(JSON.parse(root.out) as unknown);
  });

  it("`discussion post --help --format json` (leaf command) is parseable too", async () => {
    const { out } = await run(["discussion", "post", "--help", "--format", "json"]);
    expect((JSON.parse(out) as { name: string }).name).toBe("synchain");
  });
});

describe("text `--help` is unchanged", () => {
  it("still prints commander's text help plus the documentation links", async () => {
    const { out, error } = await run(["--help"]);
    expect((error as CommanderError).exitCode).toBe(0);
    expect(() => JSON.parse(out) as unknown).toThrow();
    expect(out).toMatch(/^Usage: synchain \[options\] \[command\]/);
    expect(out).toContain("--format <fmt>");
    expect(out).toContain(`AI agents: install + usage guide at\n  ${DOCS_AGENTS}\n`);
    expect(out).toContain(`Humans: full reference at\n  ${DOCS_README}\n`);
  });

  it("`--format text --help` is the same text", async () => {
    const plain = await run(["--help"]);
    const explicit = await run(["--format", "text", "--help"]);
    expect(explicit.out).toBe(plain.out);
  });

  it("a subcommand's text help is unchanged too", async () => {
    const { out } = await run(["files", "--help"]);
    expect(out).toMatch(/^Usage: synchain files \[options\] \[command\]/);
    expect(out).toContain("upload [options] <localPath>");
  });
});

describe("`-h` as an option value is a value, not a help request", () => {
  it("`discussion post --title -h --content x` runs the command and prints no help", async () => {
    const discMod = await import("../commands/discussion.js");
    const before = (discMod.runDiscussionPost as Mock).mock.calls.length;
    const { out, err, error } = await run([
      "discussion",
      "post",
      "--title",
      "-h",
      "--content",
      "x",
    ]);

    expect(error).toBeUndefined();
    expect(out).toBe("");
    expect(err).toBe("");
    const calls = (discMod.runDiscussionPost as Mock).mock.calls;
    expect(calls.length).toBe(before + 1);
    expect(calls[calls.length - 1]![0]).toMatchObject({ title: "-h", content: "x" });
  });

  it("the same holds with --format json in play", async () => {
    const discMod = await import("../commands/discussion.js");
    const { out, error } = await run([
      "--format",
      "json",
      "discussion",
      "post",
      "--title",
      "--help",
      "--content",
      "x",
    ]);
    expect(error).toBeUndefined();
    expect(out).toBe("");
    const calls = (discMod.runDiscussionPost as Mock).mock.calls;
    expect(calls[calls.length - 1]![0]).toMatchObject({
      title: "--help",
      content: "x",
      json: true,
    });
  });
});
